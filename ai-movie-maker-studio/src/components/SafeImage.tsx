import { useState } from 'react';
import { Film } from 'lucide-react';

interface SafeImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}

export function SafeImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackLabel,
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#161B24] via-[#10141B] to-[#0B0D11] text-slate-500 p-3 text-center select-none">
        <Film className="w-5 h-5 mb-1.5 text-slate-600" aria-hidden="true" />
        <span className="text-[11px] font-medium text-slate-400 line-clamp-2">
          {fallbackLabel || alt || 'No preview image'}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
