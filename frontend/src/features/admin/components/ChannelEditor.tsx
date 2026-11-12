import { ChevronDown, ChevronRight, Pencil, X } from 'lucide-react';
import type { ChannelEditorState } from '../hooks/useChannelEditor';

export function ChannelEditor({ editor }: { editor: ChannelEditorState }) {
  return (
    <div className="border border-border rounded-md">
      <button
        type="button"
        onClick={editor.toggleAdvanced}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium bg-muted/40 hover:bg-muted/60 transition-colors"
      >
        <span>Advanced (Channels)</span>
        {editor.advancedOpen ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
      {editor.advancedOpen && (
        <div className="p-3 space-y-3">
          <div className="text-sm font-medium text-foreground">Channel Config</div>
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Channels (JSON)</label>
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-ring h-32 font-mono"
              value={editor.input}
              onChange={e => editor.setInput(e.target.value)}
              placeholder='[{"name":"odom","topic":"/odom_ui","msgType":"nav_msgs/Odometry","direction":"subscribe"}]'
            />
            <div className="text-xs text-muted-foreground">
              Provide an array of channels. Leave blank to start from defaults. Edit/Delete rows
              below to change the working set; Save to persist to the robot. Use{' '}
              <code>connectionId</code> (e.g. "default", "control", or "mapping") to pick which ROS
              bridge port to use.
            </div>
            {editor.error && <div className="text-xs text-destructive mt-1">{editor.error}</div>}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={editor.apply}
              className="px-3 py-2 bg-muted text-foreground rounded-md text-sm font-medium focus-ring"
            >
              Apply Channels
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">Effective Channels</div>
            <div className="rounded-md border border-border bg-muted/30">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground bg-muted/40">
                    <th className="px-2 py-1 text-left">Name</th>
                    <th className="px-2 py-1 text-left">Direction</th>
                    <th className="px-2 py-1 text-left">Conn</th>
                    <th className="px-2 py-1 text-left">Topic</th>
                    <th className="px-2 py-1 text-left">Type</th>
                    <th className="px-2 py-1 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {editor.channels.map(ch => (
                    <tr key={ch.name} className="border-t border-border/60">
                      <td className="px-2 py-1 font-medium">{ch.name}</td>
                      <td className="px-2 py-1">{ch.direction}</td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {ch.connectionId ?? 'default'}
                      </td>
                      <td className="px-2 py-1">{ch.topic}</td>
                      <td className="px-2 py-1 text-muted-foreground">{ch.msgType}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => editor.editRow(ch)}
                            className="p-1 rounded hover:bg-muted focus-ring"
                            title="Edit channel"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => editor.deleteRow(ch)}
                            className="p-1 rounded hover:bg-muted focus-ring"
                            title="Delete channel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
