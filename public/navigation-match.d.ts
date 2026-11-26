export function selectNavigationItem<T extends { href: string }>(items: T[], pathname: string, search?: string | URLSearchParams): T | undefined;
