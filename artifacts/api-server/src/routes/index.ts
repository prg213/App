import { Router } from "express";
import healthRouter from "./health";
import activateRouter from "./activate";
import devicesRouter from "./devices";
import adminRouter from "./admin";

const router: Router = Router();

router.use(healthRouter);
router.use(activateRouter);
router.use(devicesRouter);
router.use(adminRouter);

export default router;
