import { Copy, Download, X } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard, downloadCredentials } from '@/lib/credentials-download';

interface TemporaryPasswordProps {
  username: string;
  email: string;
  password: string;
  onDismiss: () => void;
}

// Shown once: the server never returns this password again.
export function TemporaryPassword({
  username,
  email,
  password,
  onDismiss,
}: TemporaryPasswordProps) {
  const copy = async () => {
    await copyToClipboard(password);
    toast.success('Password copied');
  };

  return (
    <div className="bg-accent/40 border border-border rounded-md p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-foreground">
          Temporary password for <span className="font-medium">{username}</span>. Share it securely.
          It expires in 72 hours and won&apos;t be shown again.
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground focus-ring"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <code className="px-2 py-1 bg-muted rounded text-sm text-foreground break-all">
          {password}
        </code>
        <button
          type="button"
          onClick={copy}
          className="px-3 py-1 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm inline-flex items-center gap-2 focus-ring"
        >
          <Copy className="h-4 w-4" />
          Copy
        </button>
        <button
          type="button"
          onClick={() => downloadCredentials({ username, email, password })}
          className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 text-sm inline-flex items-center gap-2 focus-ring"
        >
          <Download className="h-4 w-4" />
          Download
        </button>
      </div>
    </div>
  );
}
