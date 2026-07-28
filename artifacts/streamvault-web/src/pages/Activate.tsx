import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Play, Plus, Trash2, Monitor, CheckCircle2, AlertCircle, LogOut, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { useClerk, useUser } from '@clerk/react';

const API = '/api';
const ADMIN_EMAIL = 'prgriffiths123@gmail.com';

type Device = {
  id: number;
  mac_address: string;
  name?: string | null;
  type?: string | null;
  host?: string | null;
  m3u_url?: string | null;
  created_at: string;
  registered_by?: string; // admin view only
};

function Toast({ msg, kind }: { msg: string; kind: 'success' | 'error' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl border text-sm font-medium shadow-xl ${
        kind === 'success'
          ? 'bg-[#0e1a12] border-emerald-500/40 text-emerald-400'
          : 'bg-[#1a0e0e] border-red-500/40 text-red-400'
      }`}
    >
      {kind === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {msg}
    </motion.div>
  );
}

export default function Activate() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const isAdmin = user?.primaryEmailAddress?.emailAddress === ADMIN_EMAIL;

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<'idle' | 'verifying' | 'saving'>('idle');
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);

  // Form state
  const [mac, setMac] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'xtream' | 'm3u'>('xtream');
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [m3uUrl, setM3uUrl] = useState('');

  function showToast(msg: string, kind: 'success' | 'error') {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }

  async function loadDevices() {
    try {
      const endpoint = isAdmin ? `${API}/admin/devices` : `${API}/devices`;
      const res = await fetch(endpoint);
      if (res.status === 401 || res.status === 403) { setDevices([]); return; }
      const data = await res.json();
      setDevices(Array.isArray(data) ? data : []);
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user !== undefined) loadDevices();
  }, [user, isAdmin]);

  function handleMacInput(val: string) {
    const clean = val.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    const grouped = clean.match(/.{1,2}/g)?.join(':') ?? clean;
    setMac(grouped.slice(0, 17));
  }

  // While typing: only lowercase the scheme so the user can still type "://"
  function lowercaseScheme(val: string) {
    return val.replace(/^([a-zA-Z][a-zA-Z0-9+\-.]*):/, (_, s) => `${s.toLowerCase()}:`);
  }

  // At submit time: lowercase scheme + strip trailing slash
  function normaliseHost(val: string) {
    return lowercaseScheme(val).replace(/\/+$/, '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Step 1: verify Xtream credentials before saving
      if (type === 'xtream') {
        setSubmitStage('verifying');
        const vRes = await fetch(`${API}/verify-credentials`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, host: normaliseHost(host), username, password }),
        });
        const vData = await vRes.json();
        if (!vData.ok) {
          showToast(vData.error ?? 'Credential check failed', 'error');
          return;
        }
      }

      // Step 2: save the device
      setSubmitStage('saving');
      const body: Record<string, string> = {
        mac_address: mac.toUpperCase(),
        type,
        name,
        ...(type === 'xtream'
          ? { host: normaliseHost(host), username, password }
          : { m3u_url: m3uUrl }),
      };
      const res = await fetch(`${API}/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast('Device verified and activated ✓', 'success');
        setMac(''); setName(''); setHost(''); setUsername(''); setPassword(''); setM3uUrl('');
        loadDevices();
      } else {
        const err = await res.json();
        showToast(err.error ?? 'Activation failed', 'error');
      }
    } catch {
      showToast('Network error — is the API server running?', 'error');
    } finally {
      setSubmitting(false);
      setSubmitStage('idle');
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Remove this device? The app will need to be re-activated.')) return;
    const endpoint = isAdmin ? `${API}/admin/devices/${id}` : `${API}/devices/${id}`;
    await fetch(endpoint, { method: 'DELETE' });
    showToast('Device removed', 'success');
    loadDevices();
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Play className="w-3 h-3 text-black fill-black ml-0.5" />
            </div>
            <span className="text-base font-bold tracking-tight text-white">StreamVault</span>
          </Link>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <span className="hidden sm:flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-widest">
                <ShieldCheck className="w-3 h-3" /> Admin
              </span>
            )}
            {user && (
              <span className="text-xs text-white/40 hidden sm:block truncate max-w-[200px]">
                {user.primaryEmailAddress?.emailAddress}
              </span>
            )}
            <button
              onClick={() => signOut({ redirectUrl: '/' })}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/80 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/10"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 pt-28 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-10"
        >
          <h1 className="text-3xl font-bold text-white mb-2">
            {isAdmin ? 'Admin Panel' : 'Activate a Device'}
          </h1>
          <p className="text-white/50 text-sm">
            {isAdmin
              ? 'Full visibility across all registered accounts and activated MACs.'
              : 'Enter the MAC address shown in the StreamVault app along with the IPTV credentials.'}
          </p>
        </motion.div>

        <div className={`grid gap-8 ${isAdmin ? 'lg:grid-cols-[420px_1fr]' : 'lg:grid-cols-2'}`}>
          {/* ── Activation Form ── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-white/[0.03] border border-white/8 rounded-2xl p-7 self-start"
          >
            <h2 className="text-base font-semibold text-white mb-6 flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              New Activation
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Device MAC Address">
                <input
                  type="text"
                  value={mac}
                  onChange={e => handleMacInput(e.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  pattern="([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"
                  maxLength={17}
                  required
                  className={inputClass}
                />
              </Field>

              <Field label="Device Name">
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Living Room TV"
                  required
                  className={inputClass}
                />
              </Field>

              <Field label="Connection Type">
                <select
                  value={type}
                  onChange={e => setType(e.target.value as 'xtream' | 'm3u')}
                  className={inputClass}
                  required
                >
                  <option value="xtream">Xtream Codes</option>
                  <option value="m3u">M3U URL</option>
                </select>
              </Field>

              {type === 'xtream' ? (
                <>
                  <Field label="Host / Panel URL">
                    <input type="text" value={host}
                      onChange={e => setHost(lowercaseScheme(e.target.value))}
                      placeholder="http://provider.com:8080"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required className={inputClass} />
                  </Field>
                  <Field label="Username">
                    <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                      placeholder="username" required className={inputClass} />
                  </Field>
                  <Field label="Password">
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" required className={inputClass} />
                  </Field>
                </>
              ) : (
                <Field label="M3U Playlist URL">
                  <input type="url" value={m3uUrl} onChange={e => setM3uUrl(e.target.value)}
                    placeholder="http://provider.com/get.php?..." required className={inputClass} />
                </Field>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-black font-bold py-3 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                {submitStage === 'verifying' ? '🔍 Verifying credentials…'
                  : submitStage === 'saving' ? '💾 Saving…'
                  : 'Activate Device'}
              </button>
            </form>
          </motion.div>

          {/* ── Devices Panel ── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-white/[0.03] border border-white/8 rounded-2xl p-7"
          >
            <h2 className="text-base font-semibold text-white mb-6 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-primary" />
                {isAdmin ? 'All Registered Devices' : 'Your Devices'}
              </span>
              <span className="text-xs text-white/30 font-normal">
                {devices.length} device{devices.length !== 1 ? 's' : ''}
              </span>
            </h2>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-white/30 text-sm">Loading…</div>
            ) : devices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <Monitor className="w-8 h-8 text-white/10" />
                <p className="text-white/30 text-sm">No devices yet.<br />Activate one using the form.</p>
              </div>
            ) : isAdmin ? (
              /* Admin: scrollable table */
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left text-xs text-white/30 font-medium pb-3 pr-4">MAC</th>
                      <th className="text-left text-xs text-white/30 font-medium pb-3 pr-4">Type</th>
                      <th className="text-left text-xs text-white/30 font-medium pb-3 pr-4">Name / Host</th>
                      <th className="text-left text-xs text-white/30 font-medium pb-3 pr-4">Registered By</th>
                      <th className="pb-3 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {devices.map(d => (
                      <tr key={d.id} className="group">
                        <td className="py-3 pr-4">
                          <span className="font-mono text-xs bg-white/8 text-white/70 px-2 py-0.5 rounded-md whitespace-nowrap">
                            {d.mac_address}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                            d.type === 'xtream'
                              ? 'bg-primary/15 text-primary'
                              : 'bg-emerald-500/15 text-emerald-400'
                          }`}>
                            {d.type?.toUpperCase() ?? '?'}
                          </span>
                        </td>
                        <td className="py-3 pr-4 max-w-[160px]">
                          <span className="text-xs text-white/50 truncate block">
                            {d.name || d.host || d.m3u_url || '—'}
                          </span>
                        </td>
                        <td className="py-3 pr-4 max-w-[180px]">
                          <span className="text-xs text-white/40 truncate block">
                            {d.registered_by ?? '—'}
                          </span>
                        </td>
                        <td className="py-3">
                          <button
                            onClick={() => handleDelete(d.id)}
                            className="p-1.5 rounded-lg text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Regular user: card list */
              <div className="space-y-3">
                {devices.map(d => (
                  <div key={d.id}
                    className="flex items-center gap-4 bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-xs bg-white/8 text-white/70 px-2 py-0.5 rounded-md">
                          {d.mac_address}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          d.type === 'xtream'
                            ? 'bg-primary/15 text-primary'
                            : 'bg-emerald-500/15 text-emerald-400'
                        }`}>
                          {d.type?.toUpperCase() ?? '?'}
                        </span>
                      </div>
                      <p className="text-xs text-white/30 truncate">
                        {d.name || d.host || d.m3u_url || '—'}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(d.id)}
                      className="shrink-0 p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {toast && <Toast msg={toast.msg} kind={toast.kind} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-white/40 mb-1.5 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  'w-full bg-white/[0.04] border border-white/8 rounded-xl text-white text-sm px-4 py-2.5 outline-none placeholder:text-white/20 focus:border-primary/60 focus:bg-white/[0.06] transition-all [&>option]:bg-[#0a0a14]';
