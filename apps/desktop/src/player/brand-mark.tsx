import React from 'react';

/** The app mark, adapted from the project's original three-leaf design. */
export function BrandMark({ className = '' }: { className?: string }) {
  return <img className={className} src="/danmutalk-mark.svg" alt="" aria-hidden="true" />;
}
