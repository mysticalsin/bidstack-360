import { lazy } from 'react';

export const MicrosoftSignInButton = lazy(() =>
  import('@clerk/clerk-react').then((m) => ({
    default: function MicrosoftSignInButtonImpl({ label = 'Sign in with Microsoft' }: { label?: string }) {
      const { signIn, isLoaded } = m.useSignIn();
      if (!isLoaded) {
        return (
          <button
            type="button"
            disabled
            className="liquid-glass inline-flex w-full items-center justify-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-medium font-body text-white opacity-60"
          >
            <MicrosoftLogo />
            {label}
          </button>
        );
      }
      return (
        <button
          type="button"
          onClick={() => {
            void signIn?.authenticateWithRedirect({
              strategy: 'oauth_microsoft',
              redirectUrl: '/sso-callback',
              redirectUrlComplete: '/dashboard',
            });
          }}
          className="liquid-glass inline-flex w-full items-center justify-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-medium font-body text-white transition-all hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label="Sign in with Microsoft"
        >
          <MicrosoftLogo />
          {label}
        </button>
      );
    },
  })),
);

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
