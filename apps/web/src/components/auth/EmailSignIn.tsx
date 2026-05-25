import { lazy } from 'react';

export const EmailSignIn = lazy(() =>
  import('@clerk/clerk-react').then((m) => ({
    default: function EmailSignInImpl() {
      return (
        <m.SignIn
          routing="path"
          path="/login"
          signUpUrl="/login"
          afterSignInUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'shadow-none bg-transparent p-0',
              headerTitle: 'hidden',
              headerSubtitle: 'hidden',
              socialButtonsBlockButton: 'hidden',
              dividerRow: 'hidden',
              formButtonPrimary:
                'bg-white/90 hover:bg-white text-black rounded-full h-10 text-sm font-medium font-body transition-colors',
              formFieldInput:
                'bg-white/10 border-white/20 rounded-full h-10 text-sm text-white placeholder:text-white/50 font-body',
              formFieldLabel: 'text-xs text-white/70 font-body',
              footerActionLink: 'text-white/80 hover:text-white text-sm font-body',
              identityPreviewText: 'text-sm text-white font-body',
              identityPreviewEditButton: 'text-white/80 hover:text-white',
            },
          }}
        />
      );
    },
  })),
);
