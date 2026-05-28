import { lazy } from 'react';

interface MicrosoftSignInButtonProps {
  label?: string;
  variant?: 'primary' | 'secondary';
}

export const MicrosoftSignInButton = lazy(() =>
  import('@clerk/clerk-react').then((m) => ({
    default: function MicrosoftSignInButtonImpl({
      label = 'Sign in with Microsoft',
      variant = 'primary',
    }: MicrosoftSignInButtonProps) {
      const { signIn, isLoaded } = m.useSignIn();

      const baseClasses =
        'inline-flex w-full items-center justify-center gap-2.5 rounded-full px-5 py-3 text-sm font-medium font-body transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 cursor-pointer';

      const variantClasses =
        variant === 'primary'
          ? 'bg-[hsl(73,98%,57%)] text-[hsl(240,67%,1%)]'
          : 'bg-white text-[hsl(240,67%,1%)]';

      if (!isLoaded) {
        return (
          <button
            type="button"
            disabled
            className={`${baseClasses} ${variantClasses} opacity-60 cursor-not-allowed`}
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
          className={`${baseClasses} ${variantClasses}`}
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
