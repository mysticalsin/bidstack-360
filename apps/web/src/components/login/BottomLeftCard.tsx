import { motion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function BottomLeftCard() {
  const navigate = useNavigate();
  const isStub = !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  return (
    <motion.div
      className="absolute bottom-28 right-4 left-auto md:left-6 md:right-auto md:bottom-6 lg:bottom-10 lg:left-10 p-3 md:p-4 lg:p-5 rounded-[1.2rem] md:rounded-[1.5rem] lg:rounded-[2.2rem] bg-white/30 backdrop-blur-xl flex flex-col gap-2 lg:gap-3 min-w-[140px] md:min-w-[150px] lg:min-w-[180px] w-fit"
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.2 }}
    >
      <div className="flex flex-col">
        <span className="text-2xl md:text-3xl font-normal text-[rgba(30,50,90,0.9)] tracking-tight">
          98/100
        </span>
        <span className="text-[10px] md:text-[12px] font-normal text-[rgba(30,50,90,0.6)] uppercase tracking-wider">
          Quality Score
        </span>
      </div>

      {isStub && (
        <motion.button
          type="button"
          aria-label="Go to dashboard (dev bypass)"
          className="flex items-center bg-white rounded-full pl-1.5 pr-5 py-1.5 gap-2 hover:bg-white/90 transition-colors self-start group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(30,50,90,0.3)] rounded-full"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => navigate('/dashboard', { replace: true })}
        >
          <div
            className="bg-[rgba(30,50,90,0.1)] p-1 rounded-full flex items-center justify-center"
            aria-hidden="true"
          >
            <ArrowUpRight className="w-3.5 h-3.5 text-[rgba(30,50,90,0.9)]" />
          </div>
          <span className="text-[14px] font-normal text-[rgba(30,50,90,0.9)]" aria-hidden="true">
            Dashboard
          </span>
        </motion.button>
      )}
    </motion.div>
  );
}
