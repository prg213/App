import { Router } from "express";
import healthRouter from "./health";
import activateRouter from "./activate";
import devicesRouter from "./devices";
import adminRouter from "./admin";
import downloadRouter from "./download";

const router: Router = Router();

router.use(healthRouter);
router.use(activateRouter);
router.use(devicesRouter);
router.use(adminRouter);
router.use(downloadRouter);

export default router;
