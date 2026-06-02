import { motion, useReducedMotion } from 'motion/react';
import { ChevronRight, LogIn } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSignInAction } from '@/lib/auth';

export function BottomRightCorner() {
  const navigate = useNavigate();
  const { signIn } = useSignInAction();
  const shouldReduceMotion = useReducedMotion();

  const handleLogin = () => {
    signIn(() => {
      navigate('/dashboard', { replace: true });
    });
  };

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={handleLogin}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleLogin();
        }
      }}
      className="group absolute bottom-0 right-0 p-3 pt-5 pl-8 sm:p-4 sm:pt-6 sm:pl-10 md:p-6 md:pt-8 md:pl-14 bg-[#f0f0f0] hover:bg-[#e5e7eb] focus-visible:bg-[#e5e7eb] rounded-tl-[1.5rem] sm:rounded-tl-[2rem] md:rounded-tl-[3.5rem] flex items-center gap-3 sm:gap-4 md:gap-6 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(30,50,90,0.3)] transition-colors duration-200"
      initial={shouldReduceMotion ? false : { y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      whileHover={shouldReduceMotion ? undefined : { scale: 1.01 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.8, delay: 0.4 }}
      aria-label="Enter CRM Demo Sandbox"
    >
      {/* Top intersection mask */}
      <div className="absolute -top-[1.5rem] sm:-top-[2rem] md:-top-[3.5rem] right-0 w-[1.5rem] sm:w-[2rem] md:w-[3.5rem] h-[1.5rem] sm:h-[2rem] md:h-[3.5rem] pointer-events-none">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 56 56"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M56 56V0C56 30.9279 30.9279 56 0 56H56Z"
            fill="currentColor"
            className="text-[#f0f0f0] group-hover:text-[#e5e7eb] group-focus-visible:text-[#e5e7eb] transition-colors duration-200"
          />
        </svg>
      </div>

      {/* Left intersection mask */}
      <div className="absolute bottom-0 -left-[1.5rem] sm:-left-[2rem] md:-left-[3.5rem] w-[1.5rem] sm:w-[2rem] md:w-[3.5rem] h-[1.5rem] sm:h-[2rem] md:h-[3.5rem] pointer-events-none">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 56 56"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M56 56H0C30.9279 56 56 30.9279 56 0V56Z"
            fill="currentColor"
            className="text-[#f0f0f0] group-hover:text-[#e5e7eb] group-focus-visible:text-[#e5e7eb] transition-colors duration-200"
          />
        </svg>
      </div>

      {/* Circle Icon */}
      <div className="bg-[rgba(30,50,90,0.05)] w-10 h-10 md:w-14 md:h-14 rounded-full flex items-center justify-center border border-[rgba(30,50,90,0.1)] group-hover:bg-[rgba(30,50,90,0.1)] group-hover:border-[rgba(30,50,90,0.2)] transition-all duration-200">
        <LogIn className="w-5 h-5 md:w-6 md:h-6 text-[rgba(30,50,90,0.8)] group-hover:scale-110 transition-transform duration-200" />
      </div>

      {/* Info column */}
      <div className="flex flex-col">
        <span className="text-[16px] md:text-[20px] font-normal text-[rgba(30,50,90,0.95)] group-hover:text-[#2c4bff] transition-colors duration-200">
          Enter CRM
        </span>
        <div className="flex items-center gap-1 text-[rgba(30,50,90,0.6)]">
          <span className="text-[12px] md:text-[15px] font-normal">Demo Sandbox</span>
          <ChevronRight
            className="w-3.5 h-3.5 md:w-4 md:h-4 group-hover:translate-x-0.5 transition-transform duration-200"
            aria-hidden="true"
          />
        </div>
      </div>
    </motion.div>
  );
}
