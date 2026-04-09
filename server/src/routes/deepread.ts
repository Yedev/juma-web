import { Router } from "express";
import { signMiddleware } from "../middleware/sign";
import { drAuthMiddleware } from "../middleware/drAuth";

import authRoutes from "./dr/auth";
import articleRoutes from "./dr/articles";
import highlightRoutes from "./dr/highlights";
import collectionRoutes from "./dr/collections";
import homepageRoutes from "./dr/homepage";
import statsRoutes from "./dr/stats";
import syncRoutes from "./dr/sync";
import aiRoutes from "./dr/ai";

const router = Router();

// All routes use sign middleware
router.use(signMiddleware);

// Auth routes (no drAuth needed)
router.use(authRoutes);

// All routes below require drAuth
router.use(drAuthMiddleware);
router.use(articleRoutes);
router.use(highlightRoutes);
router.use(collectionRoutes);
router.use(homepageRoutes);
router.use(statsRoutes);
router.use(syncRoutes);
router.use(aiRoutes);

export default router;
