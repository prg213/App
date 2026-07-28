import { Router } from "express";

const router: Router = Router();

router.get("/dl", (_req, res): void => {
  res.redirect(302, "https://github.com/prg213/App/releases/latest/download/StreamVault.apk");
});

export default router;
