import { Fragment } from 'react';

/** Render explicit **bold** references as text and strong elements, never HTML. */
export function RichText({ text }: { text: string }) {
  return <>{text.split(/\*\*(.+?)\*\*/g).map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>)}</>;
}
