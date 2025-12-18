type IconProps = {
  className?: string;
  size?: number;
};

export function CheckIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M5 8L7 10L11 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CircleIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function WarningIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M8 1L1 14H15L8 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M8 6V9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

export function InfoIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M8 7V12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="4.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

export function ChartIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="2" y="12" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="8" y="8" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="14" y="4" width="4" height="14" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function DNAIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M6 2C6 2 8 6 8 10C8 14 6 18 6 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M14 2C14 2 12 6 12 10C12 14 14 18 14 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line x1="7" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="7.5" y1="8" x2="12.5" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="7.5" y1="12" x2="12.5" y2="12" stroke="currentColor" strokeWidth="1.5" />
      <line x1="7" y1="15" x2="13" y2="15" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function FileIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M3 2C3 1.44772 3.44772 1 4 1H9L13 5V14C13 14.5523 12.5523 15 12 15H4C3.44772 15 3 14.5523 3 14V2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M9 1V5H13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function SaveIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M5 2V5H11V2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="9" width="6" height="5" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

export function TrashIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M3 4H13L12 14H4L3 4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M2 4H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 2H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6.5 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9.5 7V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MessageIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M2 3C2 2.44772 2.44772 2 3 2H13C13.5523 2 14 2.44772 14 3V10C14 10.5523 13.5523 11 13 11H9L5 14V11H3C2.44772 11 2 10.5523 2 10V3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}

export function ClockIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M8 4V8L10.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function AIIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="6.5" r="1" fill="currentColor" />
      <path d="M5 10C5 10 6 11.5 8 11.5C10 11.5 11 10 11 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 3L5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 3L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MicroscopeIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M9 4L14 4L14 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="11.5" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M11.5 10L11.5 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 14L15 14L16 18L7 18Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M6 20L18 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 6L17 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="18" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function SparklesIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M12 3L13.5 8.5L19 10L13.5 11.5L12 17L10.5 11.5L5 10L10.5 8.5L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M19 4L19.5 6L21.5 6.5L19.5 7L19 9L18.5 7L16.5 6.5L18.5 6L19 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
      <path d="M6 16L6.5 18L8.5 18.5L6.5 19L6 21L5.5 19L3.5 18.5L5.5 18L6 16Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function CacheIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <ellipse cx="12" cy="6" rx="8" ry="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M4 6L4 12C4 13.6569 7.58172 15 12 15C16.4183 15 20 13.6569 20 12L20 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 12L4 18C4 19.6569 7.58172 21 12 21C16.4183 21 20 19.6569 20 18L20 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function HelpCircleIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M9.5 9C9.5 7.61929 10.6193 6.5 12 6.5C13.3807 6.5 14.5 7.61929 14.5 9C14.5 10.3807 13.3807 11.5 12 11.5V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

export function FolderIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M3 7C3 5.89543 3.89543 5 5 5H9L11 7H19C20.1046 7 21 7.89543 21 9V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M3 9H21" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function SunIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M12 2V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 20V22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M22 12H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 12H2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M19.0711 4.92893L17.6569 6.34315" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6.34315 17.6569L4.92893 19.0711" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M19.0711 19.0711L17.6569 17.6569" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6.34315 6.34315L4.92893 4.92893" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function MoonIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function CrownIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Ornate crown */}
      <path d="M3 18H21V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V18Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />

      {/* Crown points */}
      <path d="M3 18L6 8L9 13L12 6L15 13L18 8L21 18" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />

      {/* Decorative gems on crown points */}
      <circle cx="6" cy="8" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="12" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="18" cy="8" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="none" />

      {/* Inner gem details */}
      <circle cx="6" cy="8" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="12" cy="6" r="0.6" fill="currentColor" opacity="0.6" />
      <circle cx="18" cy="8" r="0.5" fill="currentColor" opacity="0.6" />

      {/* Ornate band decoration */}
      <path d="M4 19H20" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />

      {/* Side decorations */}
      <path d="M7.5 18V20.5" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
      <path d="M12 18V20.5" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
      <path d="M16.5 18V20.5" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />
    </svg>
  );
}

// Premium Feature Icons - Ornate and intricate
// Run All: Machine that processes genes into reports
export function RunAllIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Machine body - ornate box */}
      <rect x="5" y="8" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5.5" y="8.5" width="13" height="9" rx="0.5" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />

      {/* Input funnel (left) for genes */}
      <path d="M2 5L5 8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 5L3.5 5L5 6.5" stroke="currentColor" strokeWidth="1" opacity="0.3" />

      {/* DNA helix going into machine */}
      <circle cx="2" cy="4" r="0.8" fill="currentColor" opacity="0.6" />
      <circle cx="3" cy="5.5" r="0.6" fill="currentColor" opacity="0.5" />
      <circle cx="4" cy="6.5" r="0.5" fill="currentColor" opacity="0.4" />
      <line x1="2" y1="4" x2="4" y2="6.5" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />

      {/* Output chute (right) for reports */}
      <path d="M19 18L22 20" stroke="currentColor" strokeWidth="1.2" />
      <path d="M19.5 17.5L21 19L22 20" stroke="currentColor" strokeWidth="1" opacity="0.3" />

      {/* Report paper coming out */}
      <rect x="21" y="19.5" width="2" height="2.5" rx="0.3" stroke="currentColor" strokeWidth="0.8" opacity="0.7" />
      <line x1="21.5" y1="20.5" x2="22.5" y2="20.5" stroke="currentColor" strokeWidth="0.4" opacity="0.5" />
      <line x1="21.5" y1="21.5" x2="22.5" y2="21.5" stroke="currentColor" strokeWidth="0.4" opacity="0.5" />

      {/* Machine gears and processing */}
      <circle cx="9" cy="13" r="2.5" stroke="currentColor" strokeWidth="1" />
      <circle cx="9" cy="13" r="1.8" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />
      <circle cx="9" cy="13" r="0.8" fill="currentColor" opacity="0.4" />

      <circle cx="15" cy="13" r="2.5" stroke="currentColor" strokeWidth="1" />
      <circle cx="15" cy="13" r="1.8" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />
      <circle cx="15" cy="13" r="0.8" fill="currentColor" opacity="0.4" />

      {/* Gear teeth */}
      <path d="M9 10.5L9 11.2" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path d="M9 14.8L9 15.5" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path d="M6.5 13L7.2 13" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path d="M10.8 13L11.5 13" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />

      <path d="M15 10.5L15 11.2" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path d="M15 14.8L15 15.5" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path d="M12.5 13L13.2 13" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path d="M16.8 13L17.5 13" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />

      {/* Control panel on top */}
      <rect x="8" y="9" width="8" height="1.5" rx="0.3" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <circle cx="9.5" cy="9.8" r="0.3" fill="currentColor" opacity="0.6" />
      <circle cx="11" cy="9.8" r="0.3" fill="currentColor" opacity="0.6" />
      <circle cx="12.5" cy="9.8" r="0.3" fill="currentColor" opacity="0.6" />
      <rect x="13.5" y="9.5" width="1.5" height="0.6" rx="0.2" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />

      {/* Steam/processing indicator */}
      <path d="M7 6L7.3 5L7.6 6" stroke="currentColor" strokeWidth="0.6" opacity="0.4" />
      <path d="M12 6L12.3 5L12.6 6" stroke="currentColor" strokeWidth="0.6" opacity="0.4" />
      <path d="M17 6L17.3 5L17.6 6" stroke="currentColor" strokeWidth="0.6" opacity="0.4" />
    </svg>
  );
}

// LLM Chat: Witch using a typewriter
export function LLMChatIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Witch hat - pointed with ornate brim */}
      <path d="M10 3L12 1L14 3L12 8Z" stroke="currentColor" strokeWidth="1" fill="currentColor" opacity="0.8" />
      <path d="M10.5 3.5L12 2L13.5 3.5L12 7Z" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />
      <ellipse cx="12" cy="8" rx="3" ry="0.8" stroke="currentColor" strokeWidth="1" fill="currentColor" opacity="0.7" />

      {/* Witch head/face */}
      <circle cx="12" cy="10" r="2" stroke="currentColor" strokeWidth="1" />
      <circle cx="12" cy="10" r="1.5" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />

      {/* Witch hair flowing */}
      <path d="M10.5 9Q9 10 9 11" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path d="M13.5 9Q15 10 15 11" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />

      {/* Witch body/shoulders */}
      <path d="M10 11.5L8 13L8 15" stroke="currentColor" strokeWidth="1" />
      <path d="M14 11.5L16 13L16 15" stroke="currentColor" strokeWidth="1" />
      <path d="M10 12L12 12.5L14 12" stroke="currentColor" strokeWidth="1" />

      {/* Arms reaching to typewriter */}
      <path d="M8 14L6 16" stroke="currentColor" strokeWidth="1" />
      <path d="M16 14L18 16" stroke="currentColor" strokeWidth="1" />

      {/* Typewriter body - ornate vintage design */}
      <rect x="4" y="16" width="16" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="4.5" y="16.5" width="15" height="5" rx="0.5" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />

      {/* Typewriter keys */}
      <circle cx="7" cy="18.5" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="9" cy="18.5" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="11" cy="18.5" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="13" cy="18.5" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="15" cy="18.5" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="17" cy="18.5" r="0.5" fill="currentColor" opacity="0.6" />

      <circle cx="8" cy="20" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="10" cy="20" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="12" cy="20" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="14" cy="20" r="0.5" fill="currentColor" opacity="0.6" />
      <circle cx="16" cy="20" r="0.5" fill="currentColor" opacity="0.6" />

      {/* Paper coming out of typewriter */}
      <rect x="9" y="13" width="6" height="3.5" rx="0.3" stroke="currentColor" strokeWidth="0.8" opacity="0.7" />
      <line x1="10" y1="14.5" x2="14" y2="14.5" stroke="currentColor" strokeWidth="0.4" opacity="0.5" />
      <line x1="10" y1="15.5" x2="14" y2="15.5" stroke="currentColor" strokeWidth="0.4" opacity="0.5" />

      {/* Magic sparkles around */}
      <path d="M3 10L3.4 11L4 11.4L3.4 11.8L3 13L2.6 11.8L2 11.4L2.6 11L3 10Z" fill="currentColor" opacity="0.5" />
      <path d="M21 10L21.4 11L22 11.4L21.4 11.8L21 13L20.6 11.8L20 11.4L20.6 11L21 10Z" fill="currentColor" opacity="0.5" />
      <path d="M12 22L12.3 22.7L13 23L12.3 23.3L12 24L11.7 23.3L11 23L11.7 22.7L12 22Z" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

// Overview Report: Lab tech looking into microscope
export function OverviewReportIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Lab tech head */}
      <circle cx="7" cy="6" r="2.5" stroke="currentColor" strokeWidth="1" />
      <circle cx="7" cy="6" r="2" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />

      {/* Lab coat collar */}
      <path d="M5 8L4 10" stroke="currentColor" strokeWidth="1" />
      <path d="M9 8L10 10" stroke="currentColor" strokeWidth="1" />
      <path d="M5.5 8.5L7 9L8.5 8.5" stroke="currentColor" strokeWidth="1" />

      {/* Body/shoulders hunched over microscope */}
      <path d="M4 10L3 13L3 16" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 10L11 13L11 16" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 11L7 12L10 11" stroke="currentColor" strokeWidth="1" />

      {/* Arms/hands on microscope */}
      <path d="M3 15L6 17" stroke="currentColor" strokeWidth="1" />
      <path d="M11 15L9 17" stroke="currentColor" strokeWidth="1" />

      {/* Microscope base/platform */}
      <rect x="5" y="17" width="7" height="1.5" rx="0.3" stroke="currentColor" strokeWidth="1.2" />
      <rect x="4" y="18.5" width="9" height="0.8" rx="0.2" stroke="currentColor" strokeWidth="1" />

      {/* Microscope body - ornate details */}
      <rect x="7" y="12" width="3" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="7.3" y="12.3" width="2.4" height="4.4" rx="0.3" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />

      {/* Microscope eyepiece where tech is looking */}
      <ellipse cx="8.5" cy="11" rx="1.5" ry="0.8" stroke="currentColor" strokeWidth="1" fill="currentColor" opacity="0.3" />
      <ellipse cx="8.5" cy="11" rx="1" ry="0.5" stroke="currentColor" strokeWidth="0.6" opacity="0.4" />

      {/* Microscope objective lens (bottom) */}
      <circle cx="8.5" cy="17" r="1.2" stroke="currentColor" strokeWidth="1" />
      <circle cx="8.5" cy="17" r="0.7" stroke="currentColor" strokeWidth="0.6" opacity="0.3" />

      {/* Focus knobs */}
      <circle cx="10.5" cy="14" r="0.6" stroke="currentColor" strokeWidth="0.8" fill="currentColor" opacity="0.3" />
      <circle cx="10.5" cy="15.5" r="0.6" stroke="currentColor" strokeWidth="0.8" fill="currentColor" opacity="0.3" />

      {/* Slide on stage */}
      <rect x="7" y="16.5" width="3" height="0.5" rx="0.1" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />

      {/* Data/results visualization on side (screen/readout) */}
      <rect x="14" y="10" width="8" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="14.3" y="10.3" width="7.4" height="9.4" rx="0.3" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />

      {/* Graph/data lines on screen */}
      <line x1="15" y1="13" x2="21" y2="13" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <line x1="15" y1="15" x2="20" y2="15" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <line x1="15" y1="17" x2="19" y2="17" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <circle cx="15.5" cy="13" r="0.4" fill="currentColor" opacity="0.5" />
      <circle cx="15.5" cy="15" r="0.4" fill="currentColor" opacity="0.5" />
      <circle cx="15.5" cy="17" r="0.4" fill="currentColor" opacity="0.5" />

      {/* DNA helix on screen */}
      <path d="M17 11.5Q18 12 17 12.5Q16 13 17 13.5" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
      <circle cx="17" cy="11.7" r="0.3" fill="currentColor" opacity="0.4" />
      <circle cx="17" cy="13.3" r="0.3" fill="currentColor" opacity="0.4" />

      {/* Lab environment details */}
      <path d="M2 20L3 22" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
      <path d="M12 20L11 22" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />

      {/* Analysis sparkle */}
      <path d="M20 8L20.4 9L21 9.4L20.4 9.8L20 11L19.6 9.8L19 9.4L19.6 9L20 8Z" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

// Robot AI icon for LLM Chat header
export function RobotIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      {/* Antenna with ornate details */}
      <line x1="12" y1="2" x2="12" y2="4" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="1.5" r="1" stroke="currentColor" strokeWidth="1" fill="currentColor" opacity="0.3" />
      <circle cx="12" cy="1.5" r="1.5" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />

      {/* Head - ornate box with multiple layers */}
      <rect x="7" y="4" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="7.5" y="4.5" width="9" height="7" rx="1" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />
      <rect x="6.5" y="3.5" width="11" height="9" rx="2" stroke="currentColor" strokeWidth="0.8" opacity="0.15" />

      {/* Eyes - glowing ornate circles */}
      <circle cx="10" cy="8" r="1.2" fill="currentColor" opacity="0.8" />
      <circle cx="14" cy="8" r="1.2" fill="currentColor" opacity="0.8" />
      <circle cx="10" cy="8" r="1.8" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />
      <circle cx="14" cy="8" r="1.8" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />
      <circle cx="10" cy="7.5" r="0.4" fill="currentColor" opacity="0.3" />
      <circle cx="14" cy="7.5" r="0.4" fill="currentColor" opacity="0.3" />

      {/* Mouth/display panel */}
      <rect x="9" y="10" width="6" height="1" rx="0.5" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <line x1="10" y1="10.5" x2="11" y2="10.5" stroke="currentColor" strokeWidth="0.4" opacity="0.4" />
      <line x1="13" y1="10.5" x2="14" y2="10.5" stroke="currentColor" strokeWidth="0.4" opacity="0.4" />

      {/* Body - ornate rectangle */}
      <rect x="8" y="12" width="8" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.5" y="12.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="0.6" opacity="0.2" />

      {/* Chest panel with circuit pattern */}
      <rect x="9.5" y="14" width="5" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <line x1="10" y1="15" x2="11.5" y2="15" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
      <line x1="12.5" y1="15" x2="14" y2="15" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
      <line x1="10" y1="16.5" x2="14" y2="16.5" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
      <circle cx="11.5" cy="15" r="0.4" fill="currentColor" opacity="0.4" />
      <circle cx="12.5" cy="15" r="0.4" fill="currentColor" opacity="0.4" />

      {/* Arms - ornate mechanical limbs */}
      <rect x="5" y="13" width="2" height="5" rx="0.8" stroke="currentColor" strokeWidth="1" />
      <rect x="17" y="13" width="2" height="5" rx="0.8" stroke="currentColor" strokeWidth="1" />
      <rect x="5.3" y="13.3" width="1.4" height="4.4" rx="0.5" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
      <rect x="17.3" y="13.3" width="1.4" height="4.4" rx="0.5" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />

      {/* Hands/claws */}
      <circle cx="6" cy="18.5" r="0.8" stroke="currentColor" strokeWidth="0.8" fill="currentColor" opacity="0.3" />
      <circle cx="18" cy="18.5" r="0.8" stroke="currentColor" strokeWidth="0.8" fill="currentColor" opacity="0.3" />

      {/* Legs - mechanical supports */}
      <rect x="9" y="19" width="2" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1" />
      <rect x="13" y="19" width="2" height="3.5" rx="0.5" stroke="currentColor" strokeWidth="1" />
      <rect x="9.3" y="19.3" width="1.4" height="3" rx="0.3" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />
      <rect x="13.3" y="19.3" width="1.4" height="3" rx="0.3" stroke="currentColor" strokeWidth="0.5" opacity="0.2" />

      {/* Feet */}
      <rect x="8.5" y="22.5" width="2.5" height="1" rx="0.3" stroke="currentColor" strokeWidth="0.8" />
      <rect x="13" y="22.5" width="2.5" height="1" rx="0.3" stroke="currentColor" strokeWidth="0.8" />

      {/* Decorative screws/bolts */}
      <circle cx="8.5" cy="5" r="0.4" fill="currentColor" opacity="0.3" />
      <circle cx="15.5" cy="5" r="0.4" fill="currentColor" opacity="0.3" />
      <circle cx="8.5" cy="11" r="0.4" fill="currentColor" opacity="0.3" />
      <circle cx="15.5" cy="11" r="0.4" fill="currentColor" opacity="0.3" />

      {/* Energy/AI sparkles */}
      <path d="M6 7L6.3 7.7L7 8L6.3 8.3L6 9L5.7 8.3L5 8L5.7 7.7L6 7Z" fill="currentColor" opacity="0.4" />
      <path d="M18 7L18.3 7.7L19 8L18.3 8.3L18 9L17.7 8.3L17 8L17.7 7.7L18 7Z" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

export function UserIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Ornate decorative outer circle */}
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.2" opacity="0.3" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.3" />

      {/* User head with ornate details */}
      <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />

      {/* Ornate body/shoulders */}
      <path d="M5 19C5 19 7 14 12 14C17 14 19 19 19 19" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6 18.5C6 18.5 8 15 12 15C16 15 18 18.5 18 18.5" stroke="currentColor" strokeWidth="0.8" opacity="0.3" />

      {/* Decorative corner accents */}
      <path d="M4 8L5 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <path d="M20 8L19 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <path d="M8 4L9 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <path d="M16 4L15 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

export function NillionIcon({ className = "", size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Nillion "N" logo inspired design */}
      <path d="M6 18V6L12 12L18 6V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6L12 12L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
