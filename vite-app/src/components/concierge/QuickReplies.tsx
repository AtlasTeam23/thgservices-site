type Props = {
  chips: readonly string[];
  onSelect: (chip: string) => void;
};

export default function QuickReplies({ chips, onSelect }: Props) {
  if (chips.length === 0) return null;
  return (
    // data-lenis-prevent: on short landscape screens this row scrolls sideways.
    <div className="thg-cc-chips" role="group" aria-label="Quick replies" data-lenis-prevent>
      {chips.map((chip) => (
        <button key={chip} type="button" className="thg-cc-chip" onClick={() => onSelect(chip)}>
          {chip}
        </button>
      ))}
    </div>
  );
}
