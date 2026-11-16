/** Export only user-facing records; stored opponent keys are authentication secrets. */
export function exportProfileRecords(rows: { id: string; value: string }[]) {
  const opponents = new Map<string, string>();
  const label = (id: string) => {
    if (!opponents.has(id)) opponents.set(id, `opponent-${opponents.size + 1}`);
    return opponents.get(id)!;
  };
  return rows.flatMap(row => {
    const [category, ...parts] = row.id.split(':');
    if (!['pair', 'daily', 'event', 'bonus', 'gift', 'rating'].includes(category)) return [];
    const reference = category === 'pair' ? `${label(parts[0])}:${parts[1]}`
      : category === 'daily' ? `${parts[0]}:${label(parts[1])}` : parts.join(':');
    return [{ category, reference, value: JSON.parse(row.value) as unknown }];
  });
}
