/** Select one active navigation destination, including workflow query tabs.
 * Permission checks remain in the shell and on the server. */
export function selectNavigationItem(items, pathname, search = '') {
  const current = new URLSearchParams(search);
  return items.map(item => {
    if (!item.href.startsWith('/')) return null;
    const target = new URL(item.href, 'https://controldesk.invalid');
    if (pathname !== target.pathname && (target.pathname === '/' || !pathname.startsWith(target.pathname + '/'))) return null;
    const pairs = [...target.searchParams];
    if (pairs.some(([key, value]) => current.get(key) !== value)) return null;
    return { item, score: target.pathname.length + pairs.length * 1000 };
  }).filter(Boolean).sort((a, b) => b.score - a.score)[0]?.item;
}
