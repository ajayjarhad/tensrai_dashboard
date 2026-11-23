import { checkMapYaml } from '@tensrai/shared';
import { dump, load } from 'js-yaml';
import { AlertCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEditor } from './editorStore';

// Why a yaw is refused: the schema's message is terse, the person editing needs the reason.
const EXPLAIN: Record<string, string> = {
  origin: 'Nav2 ignores yaw, so zones would land in the wrong place on the robot.',
};

const lineOf = (text: string, key: string) =>
  text.split('\n').findIndex(line => line.trimStart().startsWith(`${key}:`)) + 1;

// The map's own map.yaml, checked as it is typed; the server checks it again on save.
export const checkYamlText = (text: string) => {
  let parsed: unknown;
  try {
    parsed = load(text);
  } catch (error) {
    const line = (error as { mark?: { line?: number } }).mark?.line;
    return { error: `${line === undefined ? '' : `Line ${line + 1}: `}The YAML doesn't parse.` };
  }
  const result = checkMapYaml(parsed);
  if (result.ok) return { yaml: result.yaml };
  const line = result.key ? lineOf(text, result.key) : 0;
  const message = /yaw/.test(result.message) ? 'origin yaw must be 0.' : `${result.message}.`;
  return { error: `${line ? `Line ${line}: ` : ''}${message}`, why: EXPLAIN[result.key] };
};

export function YamlDialog({ onClose }: { onClose: () => void }) {
  const yaml = useEditor(state => state.yaml);
  const commit = useEditor(state => state.commit);
  const [text, setText] = useState(() => (yaml ? dump(yaml, { flowLevel: 1 }) : ''));
  const result = useMemo(() => checkYamlText(text), [text]);

  const apply = () => {
    if (!result.yaml || !yaml) return;
    commit({ kind: 'yaml', before: yaml, after: result.yaml });
    onClose();
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Map YAML</DialogTitle>
          <DialogDescription>
            How robots read this map's image. Changes apply when you save, and reach robots when you
            sync.
          </DialogDescription>
        </DialogHeader>
        <textarea
          aria-label="Map YAML"
          aria-invalid={Boolean(result.error)}
          aria-describedby={result.error ? 'yaml-error' : undefined}
          value={text}
          spellCheck={false}
          rows={8}
          onChange={event => setText(event.target.value)}
          className="w-full rounded-md border border-input-strong bg-background p-3 font-mono text-[13px] leading-5 focus-ring-strong"
        />
        {result.error && (
          <div
            id="yaml-error"
            role="alert"
            className="flex items-start gap-2 text-sm text-status-error-ink"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">{result.error}</strong>
              {result.why ? ` ${result.why}` : ''}
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Changing resolution or origin moves the image under your zones and tags. The image line is
          set per robot when the map is synced.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={apply}
            disabled={!result.yaml}
            title={result.yaml ? undefined : 'Fix the error first'}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
