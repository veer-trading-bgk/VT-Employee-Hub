// Hand-authored, brand-representative channel glyphs — NOT pixel-exact official
// logos (lucide-react ships neither a WhatsApp nor an Instagram icon; the
// Instagram side previously used lucide's generic `Camera` as a placeholder).
// Drawn to match lucide's own stroke-icon conventions (24x24 viewBox,
// `currentColor`, ~1.6-1.8 stroke width) so they sit visually consistent
// alongside every other icon in the app. If pixel-perfect brand compliance is
// ever required, swap these for Meta's official brand assets.

interface BrandIconProps {
  className?: string;
}

// WhatsApp — a rounded chat-bubble-with-tail outline plus a simplified
// telephone-handset glyph (the two motifs WhatsApp's own mark combines).
export function WhatsAppIcon({ className }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3C7.03 3 3 7.03 3 12c0 1.77.51 3.42 1.4 4.81L3 21l4.35-1.37A8.93 8.93 0 0 0 12 21c4.97 0 9-4.03 9-9s-4.03-9-9-9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.7 10.3c.2-.9.9-1 1.3-1h.5a.5.5 0 0 1 .46.3l.6 1.4a.5.5 0 0 1-.1.55l-.55.55a5.6 5.6 0 0 0 2.4 2.4l.55-.55a.5.5 0 0 1 .55-.1l1.4.6a.5.5 0 0 1 .3.46v.5c0 .4-.1 1.1-1 1.3-2.9.65-6.3-2.75-6.96-5.95-.1-.5-.05-.9.05-1.35Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Instagram — a rounded square with a centered lens circle and a flash dot,
// the universally recognized simplified rendition of the app's mark.
export function InstagramIcon({ className }: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17.2" cy="6.8" r="1.15" fill="currentColor" />
    </svg>
  );
}
