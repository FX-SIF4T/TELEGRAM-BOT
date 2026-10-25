export function shouldUnsendForReaction(config, update) {
  if (config?.enabled !== true || !update?.chat?.id || !update?.message_id) return false;

  const allowedEmoji = Array.isArray(config.emoji)
    ? config.emoji.filter((emoji) => typeof emoji === 'string' && emoji)
    : [];
  const oldEmoji = new Set((update.old_reaction ?? [])
    .filter((reaction) => reaction.type === 'emoji')
    .map((reaction) => reaction.emoji));

  return (update.new_reaction ?? []).some((reaction) =>
    reaction.type === 'emoji' &&
    (allowedEmoji.length === 0 || allowedEmoji.includes(reaction.emoji)) &&
    !oldEmoji.has(reaction.emoji)
  );
}
