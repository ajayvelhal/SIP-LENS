// LiveRegion (UI design component 32): visually hidden polite and assertive regions mounted once in App.
import { useSyncExternalStore } from 'react';
import { getAnnouncement, subscribeAnnouncements } from '../../lib/announce';

export function LiveRegion() {
  const a = useSyncExternalStore(subscribeAnnouncements, getAnnouncement, getAnnouncement);
  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">{a.polite}</div>
      <div aria-live="assertive" role="alert" aria-atomic="true" className="sr-only">{a.assertive}</div>
    </>
  );
}
