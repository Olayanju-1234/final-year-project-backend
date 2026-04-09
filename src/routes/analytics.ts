import { Router } from 'express';
import { auth, authorize } from '@/middleware/auth';
import { getLandlordAnalytics, getTenantAnalytics } from '@/controllers/analyticsController';

export const analyticsRoutes = Router();

/** Landlord dashboard analytics */
analyticsRoutes.get('/landlord', auth, authorize('landlord'), getLandlordAnalytics);

/** Tenant dashboard analytics */
analyticsRoutes.get('/tenant', auth, authorize('tenant'), getTenantAnalytics);
