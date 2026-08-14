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
            // Clerk's <SignIn> IS the single login card (Hero.tsx puts the brand
            // above it, no wrapper). Style the card cleanly; hide its own header
            // (we render the title/subtitle above); flatten the dev footer chrome.
            variables: { colorPrimary: '#111826', borderRadius: '12px' },
            elements: {
              rootBox: 'w-full',
              cardBox: 'w-full rounded-3xl shadow-2xl border-0',
              card: 'bg-white rounded-3xl px-6 py-7 sm:px-7',
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
              footer: 'bg-transparent shadow-none',
            },
          }}
        />
      );
    },
  })),
);
