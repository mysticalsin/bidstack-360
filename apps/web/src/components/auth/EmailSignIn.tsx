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
            // Flatten Clerk's own card so the form blends into the white login
            // card in Hero.tsx (one surface, not a card-in-a-card). Light theme.
            elements: {
              rootBox: 'w-full',
              cardBox: 'shadow-none bg-transparent w-full',
              card: 'shadow-none bg-transparent p-0',
              header: 'hidden',
              headerTitle: 'hidden',
              headerSubtitle: 'hidden',
              socialButtons: 'gap-2',
              socialButtonsBlockButton:
                'border border-[#e3e6eb] rounded-full h-10 text-sm text-[#111826] hover:bg-[#f6f7f9] font-body',
              dividerRow: 'my-4',
              dividerText: 'text-[#8a93a2] text-xs font-body',
              formButtonPrimary:
                'bg-[#111826] hover:bg-black text-white rounded-full h-10 text-sm font-medium font-body transition-colors normal-case',
              formFieldInput:
                'bg-white border border-[#e3e6eb] rounded-full h-10 text-sm text-[#111826] placeholder:text-[#9aa2b1] font-body',
              formFieldLabel: 'text-xs text-[#5b6472] font-body',
              footerAction: 'text-[#5b6472]',
              footerActionLink: 'text-[#111826] hover:text-black text-sm font-body',
              identityPreviewText: 'text-sm text-[#111826] font-body',
              identityPreviewEditButton: 'text-[#5b6472] hover:text-[#111826]',
              footer: 'bg-transparent',
            },
          }}
        />
      );
    },
  })),
);
