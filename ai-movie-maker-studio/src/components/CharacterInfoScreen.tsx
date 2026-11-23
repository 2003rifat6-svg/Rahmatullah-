import { useState } from 'react';
import { Images, Plus, Trash2, Upload } from 'lucide-react';
import { CharacterCard } from '../types/studio';
import { createEmptyCharacterCard } from '../data/sampleProject';
import { characterCompleteness, characterDisplayName } from '../utils/validation';
import {
  confirmLeave,
  SectionControls,
  SectionNotice,
  SectionStatus,
  SectionTopBar,
  statusLabel,
  statusTone,
} from './SectionControls';

interface Props {
  characters: CharacterCard[];
  onSaveCharacterInfo: (card: CharacterCard) => void;
  onToggleCharacterLock: (characterId: string, nextLocked: boolean) => void;
  onDeleteCharacter: (characterId: string) => void;
  onOpenReferences: (characterId: string) => void;
  onBack: () => void;
}

interface Draft {
  nameAndDetails: string;
  infoFilename?: string;
}

/**
 * Section 2 — Character Information.
 * A new character is only a local draft until its own Save is pressed.
 * Saved characters live in the project; reference images are handled in Section 3.
 */
export function CharacterInfoScreen({
  characters,
  onSaveCharacterInfo,
  onToggleCharacterLock,
  onDeleteCharacter,
  onOpenReferences,
  onBack,
}: Props) {
  const [newCards, setNewCards] = useState<CharacterCard[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notices, setNotices] = useState<Record<string, { type: 'info' | 'error'; text: string }>>({});

  const notify = (id: string, type: 'info' | 'error', text: string) =>
    setNotices((prev) => ({ ...prev, [id]: { type, text } }));

  // New drafts that were saved are now part of `characters`.
  const pendingNew = newCards.filter((n) => !characters.some((c) => c.id === n.id));
  const allCards: Array<{ card: CharacterCard; isNew: boolean }> = [
    ...characters.map((card) => ({ card, isNew: false })),
    ...pendingNew.map((card) => ({ card, isNew: true })),
  ];

  const draftOf = (card: CharacterCard): Draft =>
    drafts[card.id] ?? { nameAndDetails: card.nameAndDetails, infoFilename: card.infoFilename };

  const isDirty = (card: CharacterCard, isNew: boolean) => {
    const d = draftOf(card);
    if (isNew) return d.nameAndDetails.trim().length > 0;
    return d.nameAndDetails !== card.nameAndDetails || d.infoFilename !== card.infoFilename;
  };

  const anyDirty = allCards.some(({ card, isNew }) => !card.locked && isDirty(card, isNew));

  const setDraft = (id: string, patch: Partial<Draft>, base: CharacterCard) =>
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { nameAndDetails: base.nameAndDetails, infoFilename: base.infoFilename }), ...patch },
    }));

  const handleAdd = () => {
    const card = createEmptyCharacterCard();
    setNewCards((prev) => [...prev, card]);
    notify(card.id, 'info', 'New character draft. It is NOT part of the project until you press Save.');
  };

  const handleSave = (card: CharacterCard) => {
    if (card.locked) return;
    const d = draftOf(card);
    if (!d.nameAndDetails.trim()) {
      notify(card.id, 'error', 'Please write Character Information (at least the name) before saving.');
      return;
    }
    onSaveCharacterInfo({ ...card, nameAndDetails: d.nameAndDetails, infoFilename: d.infoFilename });
    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[card.id];
      return copy;
    });
    notify(card.id, 'info', 'Character saved. It stays UNLOCKED. Next: add the 4 reference images in "Character Reference Images".');
  };

  const handleLock = (card: CharacterCard, isNew: boolean) => {
    if (card.locked) {
      onToggleCharacterLock(card.id, false);
      notify(card.id, 'info', 'Character unlocked. Editing is enabled again.');
      return;
    }
    if (isNew || isDirty(card, false)) {
      notify(card.id, 'error', 'Please press Save first before locking. / লক করার আগে সেভ করুন।');
      return;
    }
    onToggleCharacterLock(card.id, true);
    notify(card.id, 'info', 'Character locked. / লক করা হয়েছে।');
  };

  const handleDelete = (card: CharacterCard, isNew: boolean) => {
    if (card.locked) return;
    if (isNew) {
      setNewCards((prev) => prev.filter((c) => c.id !== card.id));
      return;
    }
    if (window.confirm(`Delete character "${characterDisplayName(card)}" and its reference images from this project?`)) {
      onDeleteCharacter(card.id);
    }
  };

  const handleInfoFile = async (card: CharacterCard, file: File) => {
    if (card.locked) return;
    const text = await file.text();
    setDraft(card.id, { nameAndDetails: text, infoFilename: file.name }, card);
    notify(card.id, 'info', `Loaded "${file.name}". Press Save to keep it.`);
  };

  const sectionStatus: SectionStatus =
    characters.length === 0
      ? pendingNew.length
        ? 'unsaved'
        : 'empty'
      : characters.every((c) => c.locked)
        ? 'locked'
        : anyDirty
          ? 'unsaved'
          : 'saved';

  const handleBack = () => {
    if (confirmLeave(anyDirty)) onBack();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <SectionTopBar
        title={`Character Information (${characters.length})`}
        subtitle="চরিত্রের তথ্য · unlimited characters"
        status={sectionStatus}
        onBack={handleBack}
      />

      <button
        type="button"
        onClick={handleAdd}
        className="w-full min-h-[48px] rounded-xl bg-[#E5A93C] hover:bg-[#F0B84D] text-[#07080B] text-sm font-bold inline-flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> Add New Character
      </button>

      {allCards.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/[0.14] bg-[#10131A] p-8 text-center text-sm text-slate-300">
          No characters yet. Tap “Add New Character”, fill in the information and press Save.
        </div>
      )}

      {allCards.map(({ card, isNew }, idx) => {
        const d = draftOf(card);
        const dirty = isDirty(card, isNew);
        const status: SectionStatus = card.locked ? 'locked' : isNew || dirty ? 'unsaved' : 'saved';
        const completeness = isNew ? null : characterCompleteness(card);
        const inputId = `char_info_file_${card.id}`;
        return (
          <section
            key={card.id}
            aria-label={`Character ${idx + 1}`}
            className="rounded-2xl border border-white/[0.08] bg-[#10131A] p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold text-white truncate">
                {idx + 1}. {d.nameAndDetails.trim() ? characterDisplayName({ id: card.id, nameAndDetails: d.nameAndDetails }) : 'New character'}
                {isNew && <span className="ml-2 text-[11px] font-semibold text-amber-300">(draft — not in project)</span>}
              </h2>
              <span className={`text-[11px] font-semibold shrink-0 ${statusTone(status)}`}>{statusLabel(status)}</span>
            </div>

            <SectionNotice
              notice={notices[card.id] ?? null}
              onDismiss={() =>
                setNotices((prev) => {
                  const copy = { ...prev };
                  delete copy[card.id];
                  return copy;
                })
              }
            />

            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`char_info_${card.id}`} className="text-xs font-semibold text-[#E5A93C]">
                Name, Age, Gender, Appearance, Clothing, Personality, Walking style, Body language
              </label>
              <input
                id={inputId}
                type="file"
                accept=".txt,.json,.md"
                disabled={card.locked}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleInfoFile(card, f);
                  e.target.value = '';
                }}
              />
              <label
                htmlFor={inputId}
                className={`min-h-[36px] px-3 rounded-lg border border-white/[0.12] text-xs font-medium inline-flex items-center gap-1.5 shrink-0 ${
                  card.locked ? 'opacity-40 cursor-not-allowed text-slate-500' : 'bg-[#07080B] hover:bg-white/[0.06] text-white cursor-pointer'
                }`}
              >
                <Upload className="w-3.5 h-3.5 text-[#E5A93C]" /> File
              </label>
            </div>

            <textarea
              id={`char_info_${card.id}`}
              rows={6}
              disabled={card.locked}
              aria-label={`Character ${idx + 1} Information`}
              value={d.nameAndDetails}
              onChange={(e) => setDraft(card.id, { nameAndDetails: e.target.value }, card)}
              placeholder={'Name: ...\nAge: ...\nGender: ...\nAppearance: ...\nClothing & Style: ...\nPersonality: ...\nWalking Style & Body Language: ...'}
              className="w-full rounded-xl bg-[#07080B] border border-white/[0.1] p-3 text-sm text-slate-100 disabled:opacity-60"
            />

            {completeness && (
              <div className={`text-[11px] ${completeness.complete ? 'text-emerald-300' : 'text-amber-300'}`}>
                {completeness.complete
                  ? 'Complete — will be included in the Main Chat bundle.'
                  : `Incomplete — not sent to Main Chat until: ${completeness.missing.join(', ')}.`}
              </div>
            )}

            <SectionControls
              compact
              locked={card.locked}
              savedClean={!isNew && !dirty}
              onSave={() => handleSave(card)}
              onToggleLock={() => handleLock(card, isNew)}
              saveLabel="Save Character"
            />

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isNew}
                onClick={() => {
                  if (confirmLeave(anyDirty)) onOpenReferences(card.id);
                }}
                className="min-h-[40px] rounded-xl border border-white/[0.12] bg-[#07080B] hover:bg-white/[0.06] disabled:opacity-40 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5"
              >
                <Images className="w-4 h-4 text-[#E5A93C]" /> Reference Images
              </button>
              <button
                type="button"
                disabled={card.locked}
                onClick={() => handleDelete(card, isNew)}
                className="min-h-[40px] rounded-xl border border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/15 disabled:opacity-40 text-xs font-semibold text-rose-300 inline-flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" /> {isNew ? 'Discard draft' : 'Delete'}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
