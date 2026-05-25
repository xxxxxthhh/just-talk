import { BookOpen, Loader2, UploadCloud } from "lucide-react";
import type { ChangeEvent } from "react";

import type { MaterialItem } from "../types";

type MaterialLibraryProps = {
  materials: MaterialItem[];
  isImporting: boolean;
  onSelect: (material: MaterialItem) => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
};

function materialMeta(material: MaterialItem): string {
  const details = [material.pack_title];
  if (material.book) details.push(material.book);
  if (material.lesson) details.push(`Lesson ${material.lesson}`);
  return details.join(" · ");
}

export function MaterialLibrary({
  materials,
  isImporting,
  onSelect,
  onImport
}: MaterialLibraryProps) {
  return (
    <section className="sidebar-section">
      <div className="panel-heading split">
        <div className="heading-title">
          <BookOpen size={18} />
          <h2>Materials</h2>
        </div>
        <label className={`secondary-button compact material-import ${isImporting ? "disabled" : ""}`}>
          {isImporting ? <Loader2 className="spin" size={15} /> : <UploadCloud size={15} />}
          Import
          <input
            aria-label="Import material JSON"
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            disabled={isImporting}
            onChange={onImport}
          />
        </label>
      </div>
      <div className="material-list">
        {materials.length === 0 ? (
          <p className="muted">No materials yet.</p>
        ) : (
          materials.map((material) => (
            <button
              type="button"
              className="material-row"
              key={material.id}
              onClick={() => onSelect(material)}
            >
              <span className="material-title">
                <strong>{material.title}</strong>
                <small>{materialMeta(material)}</small>
              </span>
              <span className="material-preview">{material.text}</span>
              {material.tags.length ? (
                <span className="material-tags">
                  {material.tags.slice(0, 3).map((tag) => (
                    <small key={tag}>{tag}</small>
                  ))}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
