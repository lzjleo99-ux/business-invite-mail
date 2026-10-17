/**
 * 应用 logo：蓝紫渐变圆角方块 + 白色信封。
 * favicon.svg 与这里保持同一设计（favicon 供浏览器标签，组件供站内顶部/侧边栏）。
 */
export const AppLogo: React.FC<{ className?: string }> = ({ className = 'h-7 w-7' }) => (
  <svg
    className={className}
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="appLogoGrad" x1="2" y1="2" x2="46" y2="46" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#2C68FF" />
        <stop offset="1" stopColor="#7A5CFF" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="12" fill="url(#appLogoGrad)" />
    <path
      d="M11 17.5h26a2 2 0 0 1 2 2v12.5a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V19.5a2 2 0 0 1 2-2Z"
      fill="#FFFFFF"
    />
    <path
      d="m9.6 18.6 12.9 9.1a2.6 2.6 0 0 0 3 0l12.9-9.1"
      stroke="#2C68FF"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
  </svg>
);

export default AppLogo;