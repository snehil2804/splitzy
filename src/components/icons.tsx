import type { SVGProps } from "react";

/**
 * Hand-rolled 24×24 stroke icons (no icon library — keeps the bundle tiny).
 * All inherit `currentColor` and accept standard SVG props.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4V15a2.5 2.5 0 0 0-5 0v5.5h-4A1.5 1.5 0 0 1 4 19z" />
    </Icon>
  );
}

export function ReceiptIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h12V20l-2.4-1.6L13.2 20l-2.4-1.6L8.4 20 6 18.4z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </Icon>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v16M8 20h8M12 4c-2 1.2-4 1.6-6 1.6M12 4c2 1.2 4 1.6 6 1.6" />
      <path d="M6 5.6 3.6 11a2.9 2.9 0 0 0 4.8 0zM18 5.6 15.6 11a2.9 2.9 0 0 0 4.8 0z" />
    </Icon>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.2 12a7.2 7.2 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.3 7.3 0 0 0-2.1-1.3L14.3 3h-4l-.4 2.6a7.3 7.3 0 0 0-2.1 1.3l-2.3-1-2 3.4 2 1.5a7.2 7.2 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7.3 7.3 0 0 0 2.1 1.3l.4 2.6h4l.4-2.6a7.3 7.3 0 0 0 2.1-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 6.5h15M9.5 6V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3V6.5M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5" />
      <path d="M10 10.5v6M14 10.5v6" />
    </Icon>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s-6.5-5.3-6.5-10.2a6.5 6.5 0 0 1 13 0C18.5 15.7 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h16M14 6l6 6-6 6" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 5 7 7-7 7" />
    </Icon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" />
      <path d="M4.5 4v4h4M19.5 20v-4h-4" />
    </Icon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 13.5A8.5 8.5 0 0 1 10.5 4 7.5 7.5 0 1 0 20 13.5z" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </Icon>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z" />
      <path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
    </Icon>
  );
}
