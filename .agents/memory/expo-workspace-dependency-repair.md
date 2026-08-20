---
name: Expo workspace dependency repair
description: Recovering a missing installed Expo config plugin in the pnpm mobile workspace.
---

When Expo reports that a config plugin declared in the app configuration cannot be resolved, first verify the dependency is declared and locked. If it is, restore that workspace's installed dependencies from the frozen lockfile rather than removing the plugin or changing its version.

**Why:** The package declaration and lockfile can be correct while the per-workspace pnpm link/store entry is absent, causing Expo startup to fail before Metro begins.

**How to apply:** Use the mobile workspace's lockfile-preserving install to restore the missing installed package, then restart the managed Expo workflow and verify Metro starts. Treat optional React Native DevTools helper-library errors separately when Metro remains running.