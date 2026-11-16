import React, { useMemo, useState } from 'react';
import { Autocomplete, Chip, TextField } from '@mui/material';
import { Section } from 'src/components/ItemControls/components/Section';
import { trafficIdentity } from 'src/schemas/common';
import { useTranslation } from 'src/stores/localeStore';
import { useTraffic } from './TrafficContext';
import { suggestIdentities } from './seen';

export const MAX_IDENTITIES = 20;

interface Props {
  ids: string[];
  /** `undefined` when the last identity was removed, so the binding is dropped. */
  onChange: (ids: string[] | undefined) => void;
}

/** The "Live traffic" section of the box settings: the identities a box owns. */
export const TrafficIdentities = ({ ids, onChange }: Props) => {
  const { t } = useTranslation('traffic');
  const traffic = useTraffic();
  const [error, setError] = useState<string | null>(null);
  const summary = traffic?.feed.summary;
  const index = traffic?.index;

  const suggestions = useMemo(
    () =>
      summary && index
        ? suggestIdentities(summary, index).filter((id) => !ids.includes(id))
        : [],
    [summary, index, ids]
  );

  const commit = (next: string[]): void => {
    setError(null);
    onChange(next.length > 0 ? next : undefined);
  };

  const handleChange = (
    next: string[],
    reason: string
  ): void => {
    if (reason !== 'createOption' && reason !== 'selectOption') {
      commit(next);
      return;
    }
    const added = (next[next.length - 1] ?? '').trim();
    if (ids.includes(added)) {
      setError(null);
      return;
    }
    if (!trafficIdentity.safeParse(added).success) {
      setError(t('invalidIdentity'));
      return;
    }
    if (ids.length >= MAX_IDENTITIES) {
      setError(t('tooManyIdentities'));
      return;
    }
    commit([...ids, added]);
  };

  return (
    <Section title={t('section')}>
      <Autocomplete
        multiple
        freeSolo
        size="small"
        options={suggestions}
        value={ids}
        onChange={(_event, next, reason) => handleChange(next, reason)}
        onInputChange={(_event, _value, reason) => {
          if (reason === 'input') setError(null);
        }}
        renderTags={(value, getTagProps) =>
          value.map((id, position) => {
            const { key, ...tagProps } = getTagProps({ index: position });
            return <Chip key={key} label={id} size="small" {...tagProps} />;
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={t('addIdentity')}
            error={error !== null}
            helperText={error ?? t('identityHint')}
          />
        )}
      />
    </Section>
  );
};
