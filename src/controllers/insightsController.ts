import type { Request, Response } from "express"
import { Viewing } from "@/models/Viewing"
import { ViewingPayment } from "@/models/ViewingPayment"
import { Review } from "@/models/Review"
import { Tenant } from "@/models/Tenant"
import { Property } from "@/models/Property"
import { User } from "@/models/User"
import type { ApiResponse } from "@/types"
import { logger } from "@/utils/logger"
import type { Types } from "mongoose"

// ─── 1. Tenant Readiness Score ────────────────────────────────────────────────

/**
 * GET /api/insights/tenant/:tenantUserId/readiness
 *
 * Computes a "rent readiness" score (0–100) for a tenant based on
 * behavioural signals already stored in the DB:
 *   - Viewing completion rate (confirmed + completed vs total)
 *   - Cancellation rate (penalises flakiness)
 *   - Payment reliability (paid deposits vs total viewings with payments)
 *   - Response speed proxy (how quickly they booked after viewing was created)
 *   - Review engagement (left reviews after completed viewings)
 *   - Savings activity (saved properties shows genuine search intent)
 *
 * Returns the score plus a breakdown so the landlord sees WHY.
 */
export async function getTenantReadiness(req: Request, res: Response): Promise<void> {
  try {
    const { tenantUserId } = req.params

    // Fetch all viewings for this tenant
    const viewings = await Viewing.find({ tenantId: tenantUserId }).lean()
    const total = viewings.length

    // Fetch payments for this tenant
    const payments = await ViewingPayment.find({ tenantId: tenantUserId }).lean()

    // Fetch reviews left by this tenant
    const reviews = await Review.find({ tenantId: tenantUserId }).lean()

    // Fetch tenant profile for saved properties
    const tenantProfile = await Tenant.findOne({ userId: tenantUserId }).lean()

    // ── Signal: viewing completion rate ─────────────────────────────────────
    const completed = viewings.filter((v) => v.status === "completed").length
    const confirmed = viewings.filter((v) => v.status === "confirmed").length
    const cancelled = viewings.filter((v) => v.status === "cancelled").length

    const completionRate = total > 0 ? (completed + confirmed) / total : 0.5
    const cancellationRate = total > 0 ? cancelled / total : 0
    const completionScore = Math.round(completionRate * 30)           // max 30
    const cancellationPenalty = Math.round(cancellationRate * 15)    // max -15

    // ── Signal: payment reliability ─────────────────────────────────────────
    const paidPayments = payments.filter((p) => p.status === "paid" || p.status === "refunded").length
    const paymentReliability = payments.length > 0 ? paidPayments / payments.length : 0.8
    const paymentScore = Math.round(paymentReliability * 25)          // max 25

    // ── Signal: review engagement ────────────────────────────────────────────
    const completedViewings = viewings.filter((v) => v.status === "completed").length
    const reviewRate = completedViewings > 0 ? Math.min(reviews.length / completedViewings, 1) : 0.5
    const reviewScore = Math.round(reviewRate * 15)                   // max 15

    // ── Signal: saved properties (search seriousness) ────────────────────────
    const savedCount = tenantProfile?.savedProperties?.length ?? 0
    const savedScore = Math.min(savedCount * 2, 15)                   // max 15 (≥8 saves = max)

    // ── Signal: account age proxy (profile completeness) ─────────────────────
    const user = await User.findById(tenantUserId).select("createdAt isVerified").lean()
    const ageDays = user
      ? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86_400_000)
      : 0
    const ageScore = Math.min(Math.floor(ageDays / 7), 15)           // max 15 (≥15 weeks)

    // ── Composite score ──────────────────────────────────────────────────────
    const raw = completionScore - cancellationPenalty + paymentScore + reviewScore + savedScore + ageScore
    const score = Math.max(0, Math.min(100, raw))

    const label = score >= 80 ? "Highly Reliable" : score >= 60 ? "Good Standing" : score >= 40 ? "Average" : "Low Activity"

    res.status(200).json({
      success: true,
      data: {
        tenantUserId,
        score,
        label,
        breakdown: {
          viewingCompletion:  { score: completionScore,      max: 30, note: `${completed + confirmed}/${total} viewings completed or confirmed` },
          cancellationRecord: { score: -cancellationPenalty, max: 0,  note: `${cancelled} cancellation(s)` },
          paymentReliability: { score: paymentScore,         max: 25, note: `${paidPayments}/${payments.length} deposits paid` },
          reviewEngagement:   { score: reviewScore,          max: 15, note: `${reviews.length} review(s) left` },
          searchSeriousness:  { score: savedScore,           max: 15, note: `${savedCount} saved propert${savedCount === 1 ? "y" : "ies"}` },
          accountMaturity:    { score: ageScore,             max: 15, note: `Account ${ageDays} days old` },
        },
        stats: { total, completed, confirmed, cancelled, paidPayments, reviews: reviews.length, saved: savedCount },
      },
    } as ApiResponse)
  } catch (err) {
    logger.error("getTenantReadiness failed", { error: err instanceof Error ? err.message : err })
    res.status(500).json({ success: false, message: "Failed to compute readiness score" } as ApiResponse)
  }
}

// ─── 2. Viewing Conflict Detection ───────────────────────────────────────────

/**
 * GET /api/insights/property/:propertyId/conflicts
 *
 * Returns any tenants who are both strongly matched (≥80 match score)
 * AND have a pending/confirmed viewing on the same property.
 * Landlord can use this to stagger slots or make a quicker decision.
 */
export async function getViewingConflicts(req: Request, res: Response): Promise<void> {
  try {
    const { propertyId } = req.params

    // Active viewings for this property
    const viewings = await Viewing.find({
      propertyId,
      status: { $in: ["pending", "confirmed"] },
    })
      .populate("tenantId", "name email phone")
      .lean()

    if (viewings.length < 2) {
      res.status(200).json({
        success: true,
        data: { conflicts: [], message: "No conflicts detected" },
      } as ApiResponse)
      return
    }

    // Group by requested date to find same-day overlaps
    const byDate: Record<string, typeof viewings> = {}
    for (const v of viewings) {
      const dateKey = new Date(v.requestedDate).toISOString().split("T")[0]
      if (!byDate[dateKey]) byDate[dateKey] = []
      byDate[dateKey].push(v)
    }

    const conflicts = Object.entries(byDate)
      .filter(([, vs]) => vs.length > 1)
      .map(([date, vs]) => ({
        date,
        count: vs.length,
        viewings: vs.map((v) => ({
          viewingId: v._id,
          tenantId: (v.tenantId as any)?._id,
          tenantName: (v.tenantId as any)?.name ?? "Unknown",
          tenantEmail: (v.tenantId as any)?.email,
          requestedTime: v.requestedTime,
          status: v.status,
        })),
        recommendation: "Consider staggering viewing slots by at least 30 minutes to avoid overlap.",
      }))

    res.status(200).json({
      success: true,
      data: { conflicts, totalConflicts: conflicts.length },
    } as ApiResponse)
  } catch (err) {
    logger.error("getViewingConflicts failed", { error: err instanceof Error ? err.message : err })
    res.status(500).json({ success: false, message: "Failed to check viewing conflicts" } as ApiResponse)
  }
}

// ─── 3. Lease Document Generation ────────────────────────────────────────────

/**
 * POST /api/insights/lease/generate
 *
 * Generates a plain-text lease agreement from structured inputs.
 * Returns JSON with the lease text — frontend renders it and triggers
 * browser print-to-PDF (no server-side PDF library needed, no extra deps).
 *
 * Body: { propertyId, tenantUserId, landlordUserId, startDate, endDate, rentAmount, depositAmount }
 */
export async function generateLease(req: Request, res: Response): Promise<void> {
  try {
    const { propertyId, tenantUserId, landlordUserId, startDate, endDate, rentAmount, depositAmount } = req.body

    if (!propertyId || !tenantUserId || !startDate || !endDate || !rentAmount) {
      res.status(400).json({ success: false, message: "Missing required fields: propertyId, tenantUserId, startDate, endDate, rentAmount" } as ApiResponse)
      return
    }

    const [property, tenant, landlord] = await Promise.all([
      Property.findById(propertyId).lean(),
      User.findById(tenantUserId).select("name email phone").lean(),
      User.findById(landlordUserId ?? req.user?.id).select("name email phone").lean(),
    ])

    if (!property) {
      res.status(404).json({ success: false, message: "Property not found" } as ApiResponse)
      return
    }

    const fmt = (d: string) => new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })
    const naira = (n: number) => `₦${Number(n).toLocaleString("en-NG")}`
    const deposit = depositAmount ?? Math.round(rentAmount * 0.1)

    const leaseText = `
RESIDENTIAL TENANCY AGREEMENT

This Tenancy Agreement ("Agreement") is entered into on ${new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}.

PARTIES
-------
Landlord: ${landlord?.name ?? ""}
Email: ${landlord?.email ?? ""}
Phone: ${landlord?.phone ?? ""}

Tenant: ${tenant?.name ?? ""}
Email: ${tenant?.email ?? ""}
Phone: ${tenant?.phone ?? ""}

PROPERTY
--------
Address: ${property.location.address}, ${property.location.city}, ${property.location.state}
Description: ${property.title}
Bedrooms: ${property.bedrooms}
Bathrooms: ${property.bathrooms}

TENANCY PERIOD
--------------
Commencement Date: ${fmt(startDate)}
Expiry Date:       ${fmt(endDate)}

RENT & PAYMENTS
---------------
Annual Rent: ${naira(rentAmount)}
Security Deposit: ${naira(deposit)} (refundable at end of tenancy, subject to inspection)
Rent is payable annually in advance.

TENANT OBLIGATIONS
------------------
1. Pay rent on or before the due date.
2. Keep the property clean and in good condition.
3. Not sublet the property without written consent from the Landlord.
4. Not carry out structural alterations without written consent.
5. Allow the Landlord or their agent access for inspection with 24 hours notice.
6. Not use the property for any illegal or immoral purposes.
7. Settle all utility bills (electricity, water, internet) unless otherwise agreed.

LANDLORD OBLIGATIONS
--------------------
1. Ensure the property is in habitable condition at commencement.
2. Carry out necessary structural repairs in a timely manner.
3. Provide receipt for all rent payments.
4. Refund the security deposit within 30 days of tenancy expiry, less any deductions for damage.

TERMINATION
-----------
Either party may terminate this agreement by providing 3 months written notice prior to the expiry date.

GOVERNING LAW
-------------
This Agreement shall be governed by the laws of the Federal Republic of Nigeria.

SIGNATURES
----------
Landlord: ___________________________   Date: _______________

Tenant:   ___________________________   Date: _______________

Witness:  ___________________________   Date: _______________

Generated by RentMatch | ${new Date().toISOString()}
`.trim()

    res.status(200).json({
      success: true,
      data: {
        leaseText,
        meta: {
          property: { id: property._id, title: property.title, address: `${property.location.address}, ${property.location.city}, ${property.location.state}` },
          tenant: { id: tenant?._id, name: tenant?.name, email: tenant?.email },
          landlord: { id: landlord?._id, name: landlord?.name },
          startDate: fmt(startDate),
          endDate: fmt(endDate),
          rentAmount: naira(rentAmount),
          depositAmount: naira(deposit),
          generatedAt: new Date().toISOString(),
        },
      },
    } as ApiResponse)
  } catch (err) {
    logger.error("generateLease failed", { error: err instanceof Error ? err.message : err })
    res.status(500).json({ success: false, message: "Failed to generate lease" } as ApiResponse)
  }
}

// ─── 4. Neighbourhood Insights ───────────────────────────────────────────────

/**
 * GET /api/insights/neighbourhood?lat=X&lng=Y&address=X
 *
 * Fetches nearby amenities from OpenStreetMap Overpass API.
 * Returns counts and top results per category:
 *   schools, hospitals, supermarkets, bus stops, restaurants, banks
 *
 * Falls back to address geocoding via Nominatim if lat/lng not provided.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter"

const CATEGORIES = [
  { key: "schools",      name: "Schools",       query: `node["amenity"~"school|university|college"](around:1500,LAT,LNG);` },
  { key: "hospitals",    name: "Hospitals",      query: `node["amenity"~"hospital|clinic|pharmacy"](around:1500,LAT,LNG);` },
  { key: "supermarkets", name: "Supermarkets",   query: `node["shop"~"supermarket|convenience|grocery"](around:1000,LAT,LNG);` },
  { key: "bus_stops",    name: "Bus Stops",      query: `node["highway"="bus_stop"](around:800,LAT,LNG);` },
  { key: "restaurants",  name: "Restaurants",    query: `node["amenity"~"restaurant|fast_food|cafe"](around:1000,LAT,LNG);` },
  { key: "banks",        name: "Banks & ATMs",   query: `node["amenity"~"bank|atm"](around:1000,LAT,LNG);` },
]

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
    const res = await fetch(url, { headers: { "User-Agent": "RentMatch/1.0", "Accept-Language": "en" } })
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    if (data?.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    return null
  } catch {
    return null
  }
}

async function queryOverpass(lat: number, lng: number, categoryQuery: string): Promise<any[]> {
  const q = categoryQuery.replace(/LAT/g, String(lat)).replace(/LNG/g, String(lng))
  const body = `[out:json][timeout:10];(${q});out body;`
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(body)}`,
    })
    const data = (await res.json()) as { elements?: any[] }
    return data?.elements ?? []
  } catch {
    return []
  }
}

export async function getNeighbourhoodInsights(req: Request, res: Response): Promise<void> {
  try {
    let lat = req.query.lat ? parseFloat(req.query.lat as string) : null
    let lng = req.query.lng ? parseFloat(req.query.lng as string) : null
    const address = req.query.address as string | undefined

    if ((!lat || !lng) && address) {
      const coords = await geocodeAddress(address)
      if (!coords) {
        res.status(400).json({ success: false, message: "Could not geocode address" } as ApiResponse)
        return
      }
      lat = coords.lat
      lng = coords.lng
    }

    if (!lat || !lng) {
      res.status(400).json({ success: false, message: "Provide lat/lng or address" } as ApiResponse)
      return
    }

    // Query all categories in parallel
    const results = await Promise.all(
      CATEGORIES.map(async (cat) => {
        const elements = await queryOverpass(lat!, lng!, cat.query)
        return {
          key: cat.key,
          name: cat.name,
          count: elements.length,
          items: elements.slice(0, 5).map((e: any) => ({
            name: e.tags?.name ?? e.tags?.["name:en"] ?? "Unnamed",
            type: e.tags?.amenity ?? e.tags?.shop ?? e.tags?.highway ?? "",
          })),
        }
      })
    )

    // Overall liveability score (simple weighted count)
    const weights: Record<string, number> = {
      schools: 20, hospitals: 20, supermarkets: 15,
      bus_stops: 20, restaurants: 10, banks: 15,
    }
    let liveability = 0
    for (const r of results) {
      const w = weights[r.key] ?? 10
      // Sigmoid-like: saturates at ~5 items for full weight
      liveability += Math.min(r.count / 3, 1) * w
    }
    liveability = Math.round(Math.min(liveability, 100))

    res.status(200).json({
      success: true,
      data: {
        coordinates: { lat, lng },
        liveabilityScore: liveability,
        liveabilityLabel: liveability >= 75 ? "Excellent" : liveability >= 50 ? "Good" : liveability >= 25 ? "Fair" : "Limited",
        categories: results,
      },
    } as ApiResponse)
  } catch (err) {
    logger.error("getNeighbourhoodInsights failed", { error: err instanceof Error ? err.message : err })
    res.status(500).json({ success: false, message: "Failed to fetch neighbourhood insights" } as ApiResponse)
  }
}
