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
