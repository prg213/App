import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { dark } from '@clerk/themes';
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import { motion, Variants } from 'framer-motion';
import { Download, Tv, Film, ListVideo, FastForward, Key, Zap, ChevronRight, Play, LogOut } from 'lucide-react';
import { useEffect } from 'react';
import Activate from './pages/Activate';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const clerkAppearance = {
  baseTheme: dark,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#00e5ff',
    colorForeground: '#f2f2f2',
    colorMutedForeground: '#6b7280',
    colorDanger: '#ef4444',
    colorBackground: '#0a0a14',
    colorInput: '#13131e',
    colorInputForeground: '#f2f2f2',
    colorNeutral: '#252538',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#0a0a14] border border-white/10 rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-black/60',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-white',
    headerSubtitle: 'text-white/50',
    socialButtonsBlockButtonText: 'text-white/80',
    formFieldLabel: 'text-white/50',
    footerActionLink: 'text-[#00e5ff]',
    footerActionText: 'text-white/40',
    dividerText: 'text-white/30',
    identityPreviewEditButton: 'text-[#00e5ff]',
    formFieldSuccessText: 'text-emerald-400',
    alertText: 'text-white/80',
    logoBox: 'mb-2',
    logoImage: 'h-8',
    socialButtonsBlockButton: 'border-white/10 bg-white/5 hover:bg-white/10',
    formButtonPrimary: 'bg-[#00e5ff] text-black hover:bg-[#00ccee] font-bold',
    formFieldInput: 'bg-white/5 border-white/10 text-white',
    footerAction: 'bg-transparent',
    dividerLine: 'bg-white/10',
    alert: 'bg-white/5 border-white/10',
    otpCodeFieldInput: 'bg-white/5 border-white/10 text-white',
    formFieldRow: 'gap-2',
    main: 'gap-4',
  },
};

// Force dark mode on mount
function useDarkMode() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } }
};

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

function Home() {
  useDarkMode();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden selection:bg-primary/30 selection:text-primary">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Play className="w-4 h-4 text-background fill-background ml-0.5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">StreamVault</span>
          </div>
          <a 
            href="https://github.com/prg213/App/releases/download/build-245/StreamVault.apk"
            className="text-sm font-medium text-white/80 hover:text-white transition-colors"
          >
            Download APK
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
        {/* Background Image & Overlay */}
        <div className="absolute inset-0 z-0">
          <img 
            src="/hero-bg.jpg" 
            alt="Cinematic Streaming" 
            className="absolute inset-0 w-full h-full object-cover opacity-50 z-0"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background z-10" />
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary/20 blur-[120px] rounded-full z-10 pointer-events-none" />
        </div>

        <div className="relative z-20 max-w-7xl mx-auto px-6 text-center">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
            className="max-w-4xl mx-auto"
          >
            <motion.h1 variants={fadeUp} className="text-5xl md:text-7xl font-bold text-white tracking-tight mb-8 leading-[1.1]">
              Your Screen.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">Uncompromised.</span>
            </motion.h1>
            
            <motion.p variants={fadeUp} className="text-lg md:text-xl text-white/60 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
              StreamVault is built for those who know what good looks like. Bring your own IPTV subscription and watch live TV, movies, and series in a beautifully crafted, cinema-grade interface.
            </motion.p>
            
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a 
                href="https://github.com/prg213/App/releases/download/build-245/StreamVault.apk"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex items-center gap-3 bg-primary hover:bg-primary/90 text-background px-8 py-4 rounded-xl font-bold text-lg transition-all hover:scale-105 active:scale-95 shadow-[0_0_40px_-10px_rgba(0,229,255,0.5)]"
              >
                <Download className="w-6 h-6" />
                <span>Download APK</span>
                <div className="absolute inset-0 rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
              <a
                href="/activate"
                className="flex items-center gap-2 border border-white/15 hover:border-white/30 text-white/70 hover:text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all hover:scale-105 active:scale-95"
              >
                <Key className="w-5 h-5" />
                <span>Activate Device</span>
              </a>
            </motion.div>

            <motion.div variants={fadeUp} className="mt-10 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-white/10">
              <span className="text-xs font-bold tracking-widest text-white/50 uppercase">⚠ We do not provide any channels or playlists</span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative py-24 z-20 border-t border-white/5 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            className="text-center mb-16"
          >
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Everything you need. Nothing you don't.</h2>
            <p className="text-white/50 max-w-2xl mx-auto">A meticulous blend of performance and design, built specifically for high-end viewing.</p>
          </motion.div>

          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {[
              { icon: Tv, title: "Live TV & Channels", desc: "Instantly flip through live broadcast channels with zero buffering and pristine quality." },
              { icon: Film, title: "Movies On-Demand", desc: "Browse your provider's movie catalog with rich posters, synopsis, and cast details." },
              { icon: ListVideo, title: "Binge Series", desc: "Perfectly organized TV series with automatic episode tracking and season selection." },
              { icon: Zap, title: "EPG / TV Guide", desc: "A buttery-smooth timeline guide so you always know what's playing right now." },
              { icon: FastForward, title: "Zapping", desc: "Lightning-fast previous/next channel switching. Don't wait to watch." },
              { icon: Key, title: "MAC Activation", desc: "No messy logins. Securely activate directly with your device's MAC address." }
            ].map((feat, i) => (
              <motion.div 
                key={i} 
                variants={fadeUp}
                className="bg-white/[0.02] border border-white/5 p-8 rounded-2xl hover:bg-white/[0.04] transition-colors group"
              >
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <feat.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">{feat.title}</h3>
                <p className="text-white/50 leading-relaxed">{feat.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How it Works / Immersive Section */}
      <section className="relative py-32 overflow-hidden">
        {/* Background Image & Overlay */}
        <div className="absolute inset-0 z-0 bg-background">
          <img 
            src="/features-bg.jpg" 
            alt="Abstract Streaming" 
            className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-screen z-0"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background z-10" />
          <div className="absolute top-0 w-full h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent z-20" />
        </div>

        <div className="relative z-20 max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={staggerContainer}
            >
              <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-bold text-white mb-6">
                From zero to cinema in three steps.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-lg text-white/60 mb-12">
                StreamVault is a player. We don't sell content. You bring your own IPTV subscription, we make it look incredible.
              </motion.p>

              <div className="space-y-8">
                {[
                  { step: "01", title: "Download the APK", desc: "Grab the latest version directly from our release channel. Sideload it onto your Android TV or mobile device." },
                  { step: "02", title: "Activate Device", desc: "Launch the app to reveal your unique MAC address. Provide this to your IPTV provider to authorize the device." },
                  { step: "03", title: "Start Watching", desc: "Once authorized, StreamVault automatically fetches your channels, EPG, and VOD library." }
                ].map((item, i) => (
                  <motion.div key={i} variants={fadeUp} className="flex gap-6">
                    <div className="flex-shrink-0 w-12 h-12 rounded-full border border-primary/30 flex items-center justify-center text-primary font-mono font-bold bg-primary/5">
                      {item.step}
                    </div>
                    <div>
                      <h4 className="text-xl font-semibold text-white mb-2">{item.title}</h4>
                      <p className="text-white/50">{item.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              viewport={{ once: true, margin: "-100px" }}
              className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-primary/20 aspect-[4/3] bg-background/50 backdrop-blur-sm flex items-center justify-center"
            >
              {/* Mock UI Representation */}
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 to-transparent" />
              <div className="w-full max-w-md p-8">
                <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-md">
                  <div className="flex justify-between items-center mb-8">
                    <div className="w-24 h-4 bg-white/20 rounded" />
                    <div className="w-8 h-8 rounded-full bg-white/10" />
                  </div>
                  <div className="space-y-4 mb-8">
                    <div className="w-full h-32 bg-gradient-to-r from-primary/20 to-blue-500/20 rounded-lg border border-white/5 flex items-end p-4">
                      <div className="w-1/2 h-4 bg-white/40 rounded" />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="h-24 bg-white/5 rounded-lg border border-white/5" />
                      <div className="h-24 bg-white/5 rounded-lg border border-white/5" />
                      <div className="h-24 bg-white/5 rounded-lg border border-white/5" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 h-10 bg-primary rounded-lg flex items-center justify-center">
                      <span className="text-background font-bold text-sm">Watch Now</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-24 border-t border-white/5 relative overflow-hidden bg-background">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-primary/10 blur-[100px] rounded-full pointer-events-none" />
        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-8">Ready to upgrade your screen?</h2>
          <a 
            href="https://github.com/prg213/App/releases/download/build-245/StreamVault.apk"
            className="inline-flex items-center gap-2 bg-white text-background hover:bg-white/90 px-8 py-4 rounded-xl font-bold text-lg transition-transform hover:scale-105 active:scale-95"
          >
            <Download className="w-5 h-5" />
            <span>Download for Android</span>
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-background py-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
            <Play className="w-5 h-5 text-primary fill-primary" />
            <span className="font-bold tracking-tight text-white">StreamVault</span>
          </div>
          
          <div className="flex flex-col md:flex-row items-center gap-4 text-sm text-white/40">
            <span>&copy; {new Date().getFullYear()} StreamVault. All rights reserved.</span>
            <span className="hidden md:inline">&bull;</span>
            <a 
              href="/activate"
              className="hover:text-primary transition-colors flex items-center gap-1"
            >
              Provider Admin Panel
              <ChevronRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ProtectedActivate() {
  return (
    <>
      <Show when="signed-in"><Activate /></Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      localization={{
        signIn: { start: { title: 'Sign in to StreamVault', subtitle: 'Access your device activation panel' } },
        signUp: { start: { title: 'Create your StreamVault account', subtitle: 'Get started in seconds' } },
      }}
    >
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/activate" component={ProtectedActivate} />
      </Switch>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
