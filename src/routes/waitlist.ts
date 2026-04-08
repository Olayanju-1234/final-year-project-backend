import { Router } from 'express';
import { auth } from '@/middleware/auth';
import { joinWaitlist, leaveWaitlist, getMyWaitlist, getWaitlistStatus } from '@/controllers/waitlistController';

export const waitlistRoutes = Router();

/** Join the waitlist for an occupied property */
waitlistRoutes.post('/:propertyId', auth, joinWaitlist);

/** Leave the waitlist */
waitlistRoutes.delete('/:propertyId', auth, leaveWaitlist);

/** Get all waitlist entries for the authenticated tenant */
waitlistRoutes.get('/my', auth, getMyWaitlist);

/** Check if tenant is on the waitlist for a specific property */
waitlistRoutes.get('/status/:propertyId', auth, getWaitlistStatus);
