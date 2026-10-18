import { setUi, useEditor } from '../../state/store';
import { ErrorBoundary } from '../ErrorBoundary';
import { DesignTab } from './Design';
import { AssetsTab } from './Assets';
import { LayersPanel } from './Layers';
import { Icon } from '../icons';

export function Inspector({ drawer }: { drawer?: boolean }) {
  const tab = useEditor((s) => s.ui.inspectorTab);
  const key = useEditor((s) => s.activeKey);
  return (
    <aside className={`inspector ${drawer ? 'drawer' : ''}`} aria-label="Inspector">
      <div role="tablist" className="insp-tabs" aria-label="Inspector tabs">
        <button role="tab" aria-selected={tab === 'design'} onClick={() => setUi({ inspectorTab: 'design' })}>
          Design
        </button>
        <button role="tab" aria-selected={tab === 'assets'} onClick={() => setUi({ inspectorTab: 'assets' })}>
          Assets
        </button>
        {drawer && (
          <button
            className="icon-btn sm drawer-close"
            aria-label="Hide inspector"
            onClick={() => setUi({ drawer: false })}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <div className="insp-scroll" role="tabpanel">
        <ErrorBoundary region="inspector" resetKey={key}>
          {tab === 'design' ? <DesignTab /> : <AssetsTab />}
        </ErrorBoundary>
      </div>
      <ErrorBoundary region="layers panel" resetKey={key}>
        <LayersPanel />
      </ErrorBoundary>
    </aside>
  );
}
