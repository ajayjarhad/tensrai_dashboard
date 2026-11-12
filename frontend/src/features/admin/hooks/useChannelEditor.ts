import { useState } from 'react';
import { toast } from 'sonner';
import { DEFAULT_CHANNELS, type RobotChannel } from '../robotFormModel';

export type ChannelEditorState = ReturnType<typeof useChannelEditor>;

export function useChannelEditor() {
  const [channels, setChannels] = useState<RobotChannel[]>(DEFAULT_CHANNELS);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const load = (next: RobotChannel[]) => {
    setChannels(next);
    setInput(JSON.stringify(next, null, 2));
  };

  const reset = () => {
    load(DEFAULT_CHANNELS);
    setError(null);
    setAdvancedOpen(false);
  };

  const apply = () => {
    if (!input.trim()) {
      setChannels([]);
      setError(null);
      toast.success('Channels cleared; defaults will be used');
      return;
    }
    try {
      const parsed = JSON.parse(input);
      if (!Array.isArray(parsed)) {
        throw new Error('Channels must be an array');
      }
      setChannels(parsed);
      setError(null);
      toast.success('Channels loaded. Preview updated; Save to persist.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid channels JSON';
      setError(msg);
      toast.error(msg);
    }
  };

  const editRow = (channel: RobotChannel) => {
    const current = [...channels];
    const idx = current.findIndex(ch => ch.name === channel.name);
    if (idx >= 0) {
      current[idx] = channel;
    } else {
      current.push(channel);
    }
    load(current);
    toast.success(
      `Channel "${channel.name}" loaded into editor. Apply to preview, then Save to persist.`
    );
  };

  const deleteRow = (channel: RobotChannel) => {
    if (!channels.some(ch => ch.name === channel.name)) {
      toast.error(`"${channel.name}" is not in custom list.`);
      return;
    }
    if (!confirm(`Remove override for ${channel.name}?`)) return;
    const updated = channels.filter(ch => ch.name !== channel.name);
    setChannels(updated);
    setInput(updated.length ? JSON.stringify(updated, null, 2) : '');
    toast.success(`Removed override for "${channel.name}". Apply to preview, then Save.`);
  };

  return {
    channels,
    input,
    error,
    advancedOpen,
    setInput,
    toggleAdvanced: () => setAdvancedOpen(open => !open),
    load,
    reset,
    apply,
    editRow,
    deleteRow,
  };
}
