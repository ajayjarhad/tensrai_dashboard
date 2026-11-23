import { AlertCircle, Check, FileText, Image, MapPin, Upload } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { errorMessageOf, gzipBase64, type MapSummary, mapsApi } from './api';
import { nextMapFilename } from './mapList';
import { useRefreshMaps } from './queries';
import { checkMetadata, checkPgm, checkYaml, type FileCheck, readMapYaml } from './uploadFiles';

type Kind = 'pgm' | 'yaml' | 'json';
type Picked = Partial<Record<Kind, File>>;

const KIND = [
  { key: 'pgm', test: /\.pgm$/i, icon: Image, label: 'Map image (.pgm)' },
  { key: 'yaml', test: /\.ya?ml$/i, icon: FileText, label: 'Map settings (.yaml)' },
  { key: 'json', test: /\.json$/i, icon: MapPin, label: 'Tags and missions (metadata.json)' },
] as const;

const pick = (current: Picked, files: Iterable<File>) => {
  const next = { ...current };
  for (const file of files) {
    const kind = KIND.find(candidate => candidate.test.test(file.name));
    if (kind) next[kind.key] = file;
  }
  return next;
};

const stem = (file?: File) => file?.name.replace(/\.[^.]+$/, '') ?? '';

// Reads just enough of each file to say what it is, before anything is sent.
const checkFiles = async (files: Picked): Promise<Partial<Record<Kind, FileCheck>>> => {
  const yamlText = files.yaml ? await files.yaml.text() : '';
  const resolution = yamlText ? readMapYaml(yamlText).resolution : null;
  return {
    ...(files.pgm
      ? { pgm: checkPgm(await files.pgm.slice(0, 512).text(), files.pgm.size, resolution) }
      : {}),
    ...(files.yaml ? { yaml: checkYaml(yamlText) } : {}),
    ...(files.json ? { json: checkMetadata(await files.json.text()) } : {}),
  };
};

function FileRow({
  kind,
  file,
  check,
}: {
  kind: (typeof KIND)[number];
  file: File | undefined;
  check: FileCheck | undefined;
}) {
  const Icon = kind.icon;
  return (
    <li className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 px-3 py-2.5">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      <span className="truncate font-mono text-[13px]">{file?.name ?? kind.label}</span>
      {file && check ? (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${check.ok ? 'text-status-online-ink' : 'text-status-error-ink'}`}
        >
          {check.ok ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <AlertCircle className="h-3 w-3" aria-hidden />
          )}
          {check.ok ? 'Ready' : 'Problem'}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          {kind.key === 'json' ? 'Optional' : 'Needed'}
        </span>
      )}
      {file && check && (
        <span
          className={`col-start-2 col-end-4 text-xs ${check.ok ? 'text-muted-foreground' : 'text-status-error-ink'}`}
        >
          {check.text}
        </span>
      )}
    </li>
  );
}

export function UploadMapDialog({ maps, onClose }: { maps: MapSummary[]; onClose: () => void }) {
  const [files, setFiles] = useState<Picked>({});
  const [checks, setChecks] = useState<Partial<Record<Kind, FileCheck>>>({});
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshMaps = useRefreshMaps();
  const filename = nextMapFilename(maps);
  const problem = Object.values(checks).some(check => check && !check.ok);

  useEffect(() => {
    let current = true;
    void checkFiles(files).then(result => {
      if (current) setChecks(result);
    });
    return () => {
      current = false;
    };
  }, [files]);

  const add = (list: Iterable<File>) => {
    const next = pick(files, list);
    setFiles(next);
    if (!name) setName(stem(next.yaml) || stem(next.pgm));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!files.pgm || !files.yaml || problem) return;
    setBusy(true);
    setError(null);
    try {
      const features = files.json ? JSON.parse(await files.json.text()) : undefined;
      await mapsApi.upload({
        name: name.trim(),
        yaml: await files.yaml.text(),
        pgmGzipBase64: await gzipBase64(files.pgm),
        ...(features ? { features } : {}),
      });
      await refreshMaps();
      toast.success(`${name.trim()} uploaded`);
      onClose();
    } catch (failure) {
      setError(errorMessageOf(failure, 'The upload failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[600px]">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Upload a map</DialogTitle>
            <DialogDescription>
              Add a map saved by your mapping tools: its image (.pgm) and its settings (.yaml), plus
              metadata.json if you have location tags and missions.
            </DialogDescription>
          </DialogHeader>
          <label
            htmlFor="upload-files"
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
              event.preventDefault();
              add(event.dataTransfer.files);
            }}
            className="relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input-strong bg-muted p-5 text-center focus-within:ring-2 focus-within:ring-ring-strong"
          >
            <Upload className="h-5 w-5" aria-hidden />
            <span className="font-medium">Drop files here, or choose them</span>
            <span className="text-xs text-muted-foreground">
              .pgm (P5, 8-bit) · .yaml · metadata.json · up to 8 MB compressed
            </span>
            <input
              id="upload-files"
              type="file"
              multiple
              accept=".pgm,.yaml,.yml,.json"
              onChange={event => add(event.target.files ?? [])}
              className="absolute h-px w-px opacity-0"
            />
          </label>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {KIND.map(kind => (
              <FileRow key={kind.key} kind={kind} file={files[kind.key]} check={checks[kind.key]} />
            ))}
          </ul>
          <label className="grid gap-1.5 text-sm font-medium" htmlFor="upload-name">
            Name
            <Input
              id="upload-name"
              value={name}
              maxLength={100}
              required
              onChange={event => setName(event.target.value)}
              className="border-input-strong"
            />
            <span className="text-xs font-normal text-muted-foreground">
              It is saved as <span className="font-mono">{filename}</span>. Nothing goes to a robot
              until you assign it.
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-status-error-ink">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || problem || !files.pgm || !files.yaml || !name.trim()}
            >
              {busy ? 'Uploading…' : 'Upload map'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
