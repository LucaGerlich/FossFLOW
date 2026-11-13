import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SetupBlock, SetupStep } from '../monitoring';

function CopyCode({ code }: { code: string }) {
  const { t } = useTranslation('app');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the code stays selectable in the block.
    }
  };

  return (
    <button className="btn btn--sm" type="button" onClick={copy}>
      {copied ? t('platform.monitoring.copied') : t('platform.monitoring.copy')}
    </button>
  );
}

function stepLabel(step: SetupStep, t: (key: string, options?: Record<string, string>) => string) {
  if (step.kind === 'install') return t('platform.monitoring.stepInstall');
  if (step.kind === 'env') return t('platform.monitoring.stepEnv');
  return t('platform.monitoring.stepFile', { file: step.file ?? '' });
}

/** The ready-to-paste snippets for each runtime, one tab per block. */
export function SetupBlocks({ blocks }: { blocks: SetupBlock[] }) {
  const { t } = useTranslation('app');
  const [activeId, setActiveId] = useState(blocks[0]?.id);
  const active = blocks.find((block) => block.id === activeId) ?? blocks[0];
  if (!active) return null;

  return (
    <div className="setup-blocks">
      <div className="tabs" role="tablist" aria-label={t('platform.monitoring.setupTitle')}>
        {blocks.map((block) => (
          <button
            key={block.id}
            id={`setup-tab-${block.id}`}
            className={block.id === active.id ? 'tab tab--active' : 'tab'}
            type="button"
            role="tab"
            aria-selected={block.id === active.id}
            aria-controls="setup-panel"
            onClick={() => setActiveId(block.id)}
          >
            {t(`platform.monitoring.block.${block.id}`)}
          </button>
        ))}
      </div>
      <div id="setup-panel" role="tabpanel" aria-labelledby={`setup-tab-${active.id}`} className="setup-blocks__steps">
        {active.steps.map((step, index) => (
          <div className="setup-step" key={`${active.id}-${index}`}>
            <div className="setup-step__head">
              <span className="setup-step__label">{stepLabel(step, t)}</span>
              <CopyCode code={step.code} />
            </div>
            <pre className="setup-step__code">
              <code>{step.code}</code>
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
