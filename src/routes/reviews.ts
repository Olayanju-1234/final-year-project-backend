import { Router } from 'express';
import { auth } from '@/middleware/auth';
import { submitReview, getPropertyReviews, getMyReviews } from '@/controllers/reviewController';

export const reviewRoutes = Router();

/** Submit a review after a completed viewing (tenant only) */
reviewRoutes.post('/', auth, submitReview);

/** Get all reviews for a property (public) */
reviewRoutes.get('/property/:propertyId', getPropertyReviews);

/** Get the authenticated tenant's own reviews */
reviewRoutes.get('/my', auth, getMyReviews);

/** Get activity/audit log for the authenticated user */
