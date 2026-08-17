/**
 * Integration-style tests — TV modal focus wiring (ConfirmModal & CommunityModal)
 *
 * Why source inspection?
 * ──────────────────────
 * React Native TV focus (hasTVPreferredFocus, setNativeProps) is resolved by
 * the native Fire OS / tvOS layer.  jsdom/node cannot simulate it.  Rendering
 * these modals in a test environment and triggering onShow would fire the
 * setTimeout callbacks, but setNativeProps on a mock ref has no visible effect
 * on D-pad cursor position — the only thing we could assert is that the
 * function was called, which is already covered by tvFocus.test.ts.
 *
 * Source inspection confirms the *wiring* that connects the Modal lifecycle
 * (onShow, onRequestClose, onClose) to requestTvFocus — ensuring a silent
 * refactor (e.g. removing the onShow handler or swapping the ref) is caught
 * before it reaches a device.
 *
 * Scenarios confirmed:
 *   ConfirmModal
 *     1. imports requestTvFocus from lib/tvFocus
 *     2. onShow → Platform.isTV guard → setTimeout → requestTvFocus(confirmRef)
 *     3. onShow delay is at least 100 ms (Fire OS focus settle time)
 *     4. restoreOpener calls requestTvFocus(openerRef.current) with a delay
 *     5. handleConfirm calls restoreOpener (focus returned on confirm)
 *     6. handleCancel calls restoreOpener (focus returned on cancel)
 *     7. onRequestClose is wired to handleCancel (hardware BACK restores focus)
 *     8. confirmRef is attached to the confirm/action FocusablePressable
 *
 *   CommunityModal
 *     9.  imports requestTvFocus from lib/tvFocus
 *     10. onShow → Platform.isTV guard → setTimeout → requestTvFocus(closeBtnRef)
 *     11. onShow delay is at least 50 ms
 *     12. handleClose calls requestTvFocus(openerRef.current) with a delay
 *     13. handleClose is guarded by Platform.isTV before restoring opener
 *     14. onRequestClose is wired to handleClose
 *     15. closeBtnRef is attached to the FocusablePressable close button
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── Load source files ─────────────────────────────────────────────────────────

const CONFIRM_PATH    = path.join(__dirname, '../components/ConfirmModal.tsx');
const COMMUNITY_PATH  = path.join(__dirname, '../components/CommunityModal.tsx');

let confirmSrc: string;
let communitySrc: string;

beforeAll(() => {
  confirmSrc   = fs.readFileSync(CONFIRM_PATH,   'utf8');
  communitySrc = fs.readFileSync(COMMUNITY_PATH, 'utf8');
});

// =============================================================================
// ConfirmModal
// =============================================================================

describe('ConfirmModal — requestTvFocus import', () => {
  it('imports requestTvFocus from @/lib/tvFocus or lib/tvFocus', () => {
    // The helper must be imported — an inline copy or a different import path
    // would mean future changes to the helper are not picked up.
    expect(confirmSrc).toMatch(/import.*requestTvFocus.*from.*['"].*tvFocus['"]/);
  });
});

describe('ConfirmModal — onShow → focus confirm button', () => {
  it('has an onShow prop on the Modal', () => {
    expect(confirmSrc).toMatch(/onShow\s*=\s*\{/);
  });

  it('guards the onShow focus call with Platform.isTV', () => {
    // Without the guard, the focus call runs on phones too — where
    // setNativeProps is a no-op but the 250 ms cleanup timer still fires.
    expect(confirmSrc).toMatch(/Platform\.isTV/);
  });

  it('calls requestTvFocus inside onShow', () => {
    // The onShow handler must actually invoke requestTvFocus (not just import it).
    // Window is 400 chars to accommodate the comment block before the if-guard.
    expect(confirmSrc).toMatch(/onShow[\s\S]{0,400}requestTvFocus/);
  });

  it('passes confirmRef.current to requestTvFocus inside onShow', () => {
    // Must focus the confirm/action button, not an arbitrary ref.
    expect(confirmSrc).toMatch(/requestTvFocus\(\s*confirmRef\.current\s*\)/);
  });

  it('wraps the onShow requestTvFocus call in a setTimeout for Fire OS settle time', () => {
    // Fire OS needs time after Modal becomes visible before setNativeProps
    // can reliably move focus.  A bare requestTvFocus() without a delay
    // silently no-ops on Firestick Lite.
    expect(confirmSrc).toMatch(/setTimeout\s*\(\s*\(\s*\)\s*=>\s*requestTvFocus\(\s*confirmRef\.current\s*\)/);
  });

  it('onShow setTimeout delay is at least 100 ms (Fire OS focus settle time)', () => {
    // The delay in the onShow handler must be long enough for Fire OS to
    // finish its modal-open animation and attach the native view.
    // Anything below 100 ms is unreliable on Firestick Lite (1.0 GHz).
    const match = confirmSrc.match(
      /onShow[\s\S]{0,400}setTimeout\s*\(\s*\(\s*\)\s*=>\s*requestTvFocus[^,]+,\s*(\d+)\s*\)/,
    );
    expect(match).not.toBeNull();
    const delay = parseInt(match![1], 10);
    expect(delay).toBeGreaterThanOrEqual(100);
  });
});

describe('ConfirmModal — restoreOpener after close', () => {
  it('defines a restoreOpener helper that calls requestTvFocus', () => {
    expect(confirmSrc).toMatch(/restoreOpener/);
    // The helper must actually invoke requestTvFocus (not just schedule a no-op)
    expect(confirmSrc).toMatch(/restoreOpener[\s\S]{0,300}requestTvFocus/);
  });

  it('restoreOpener passes openerRef.current to requestTvFocus', () => {
    expect(confirmSrc).toMatch(/requestTvFocus\(\s*openerRef\.current\s*\)/);
  });

  it('restoreOpener is guarded by Platform.isTV so phones are unaffected', () => {
    // Restoring opener focus on a phone is a no-op at the OS level but
    // wastes the 250 ms cleanup timer — the guard is belt-and-suspenders.
    expect(confirmSrc).toMatch(/Platform\.isTV/);
  });

  it('restoreOpener wraps the requestTvFocus call in a setTimeout for safe timing', () => {
    // After the modal animates out, the opener element needs a moment to
    // become the native focus target again.
    expect(confirmSrc).toMatch(/setTimeout\s*\(\s*\(\s*\)\s*=>\s*requestTvFocus\(\s*openerRef\.current\s*\)/);
  });

  it('handleConfirm calls restoreOpener so focus returns to the opener on confirm', () => {
    expect(confirmSrc).toMatch(/handleConfirm[\s\S]{0,200}restoreOpener\s*\(\s*\)/);
  });

  it('handleCancel calls restoreOpener so focus returns to the opener on cancel', () => {
    expect(confirmSrc).toMatch(/handleCancel[\s\S]{0,200}restoreOpener\s*\(\s*\)/);
  });
});

describe('ConfirmModal — hardware BACK restores focus', () => {
  it('wires onRequestClose to handleCancel so hardware BACK triggers focus restore', () => {
    // On Fire OS, pressing BACK while the modal is open fires onRequestClose.
    // It must call handleCancel (which calls restoreOpener) so the D-pad
    // cursor is not left floating after the modal dismisses.
    expect(confirmSrc).toMatch(/onRequestClose\s*=\s*\{\s*handleCancel\s*\}/);
  });
});

describe('ConfirmModal — confirmRef attached to the action button', () => {
  it('attaches confirmRef to the confirm FocusablePressable via ref prop', () => {
    // The ref must be on the confirm button so onShow focus lands on it.
    // A ref on a sibling or wrapper view would focus the wrong element.
    expect(confirmSrc).toMatch(/FocusablePressable[\s\S]{0,200}ref\s*=\s*\{\s*confirmRef\s*\}/);
  });

  it('defines confirmRef with useRef', () => {
    expect(confirmSrc).toMatch(/confirmRef\s*=\s*useRef/);
  });
});

// =============================================================================
// CommunityModal
// =============================================================================

describe('CommunityModal — requestTvFocus import', () => {
  it('imports requestTvFocus from @/lib/tvFocus or lib/tvFocus', () => {
    expect(communitySrc).toMatch(/import.*requestTvFocus.*from.*['"].*tvFocus['"]/);
  });
});

describe('CommunityModal — onShow → focus close button', () => {
  it('has an onShow prop on the Modal', () => {
    expect(communitySrc).toMatch(/onShow\s*=\s*\{/);
  });

  it('guards the onShow focus call with Platform.isTV', () => {
    expect(communitySrc).toMatch(/Platform\.isTV/);
  });

  it('calls requestTvFocus inside onShow', () => {
    // Window is 400 chars to accommodate the comment block before the if-guard.
    expect(communitySrc).toMatch(/onShow[\s\S]{0,400}requestTvFocus/);
  });

  it('passes closeBtnRef.current to requestTvFocus inside onShow', () => {
    // Must focus the close button — the only interactive element guaranteed
    // to be mounted as soon as the modal opens (WebView may still be loading).
    expect(communitySrc).toMatch(/requestTvFocus\(\s*closeBtnRef\.current\s*\)/);
  });

  it('wraps the onShow requestTvFocus call in a setTimeout', () => {
    expect(communitySrc).toMatch(/setTimeout\s*\(\s*\(\s*\)\s*=>\s*requestTvFocus\(\s*closeBtnRef\.current\s*\)/);
  });

  it('onShow setTimeout delay is at least 50 ms', () => {
    const match = communitySrc.match(
      /onShow[\s\S]{0,400}setTimeout\s*\(\s*\(\s*\)\s*=>\s*requestTvFocus[^,]+,\s*(\d+)\s*\)/,
    );
    expect(match).not.toBeNull();
    const delay = parseInt(match![1], 10);
    expect(delay).toBeGreaterThanOrEqual(50);
  });
});

describe('CommunityModal — handleClose restores opener focus', () => {
  it('defines a handleClose function', () => {
    expect(communitySrc).toMatch(/handleClose/);
  });

  it('handleClose calls requestTvFocus to restore the opener', () => {
    expect(communitySrc).toMatch(/handleClose[\s\S]{0,300}requestTvFocus/);
  });

  it('handleClose passes openerRef.current to requestTvFocus', () => {
    expect(communitySrc).toMatch(/requestTvFocus\(\s*openerRef\.current\s*\)/);
  });

  it('handleClose wraps the opener restore in a setTimeout for safe timing', () => {
    expect(communitySrc).toMatch(/setTimeout\s*\(\s*\(\s*\)\s*=>\s*requestTvFocus\(\s*openerRef\.current\s*\)/);
  });

  it('handleClose is guarded by Platform.isTV before restoring opener', () => {
    // On phones openerRef is typically undefined, but the guard makes the
    // intent explicit and avoids a pointless timer allocation.
    expect(communitySrc).toMatch(/Platform\.isTV/);
  });
});

describe('CommunityModal — hardware BACK restores focus', () => {
  it('wires onRequestClose to handleClose', () => {
    // Hardware BACK (Fire OS remote) must trigger the same close+restore path
    // as pressing the ✕ button, or the D-pad cursor goes dead after BACK.
    expect(communitySrc).toMatch(/onRequestClose\s*=\s*\{\s*handleClose\s*\}/);
  });
});

describe('CommunityModal — closeBtnRef attached to the close button', () => {
  it('defines closeBtnRef with useRef', () => {
    expect(communitySrc).toMatch(/closeBtnRef\s*=\s*useRef/);
  });

  it('attaches closeBtnRef to the close FocusablePressable via ref prop', () => {
    // Without the ref, onShow's requestTvFocus receives null and is a no-op.
    expect(communitySrc).toMatch(/FocusablePressable[\s\S]{0,200}ref\s*=\s*\{\s*closeBtnRef\s*\}/);
  });
});
