import { memberStyle } from "@/lib/constants";

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-xl",
} as const;

interface AvatarProps {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}

export function Avatar({ name, size = "md", className = "" }: AvatarProps) {
  const style = memberStyle(name);
  return (
    <span
      title={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-sm ring-2 ring-surface-strong ${style.gradient} ${SIZES[size]} ${className}`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Overlapping row of member avatars, e.g. expense participants. */
export function AvatarStack({ names }: { names: string[] }) {
  return (
    <span className="flex -space-x-1.5">
      {names.map((name) => (
        <Avatar key={name} name={name} size="xs" />
      ))}
    </span>
  );
}
