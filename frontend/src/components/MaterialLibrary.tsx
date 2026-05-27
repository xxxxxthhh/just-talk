import { AlertTriangle, BookOpen, Info, Loader2, Search, Trash2, UploadCloud, X } from "lucide-react";
import type { ChangeEvent, FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { MaterialItem } from "../types";

export type MaterialGroupDeleteTarget = {
  id: string;
  packId: string;
  book: string;
  title: string;
  count: number;
};

type MaterialLibraryProps = {
  materials: MaterialItem[];
  onSelect: (material: MaterialItem) => void;
  onDeleteGroup?: (group: MaterialGroupDeleteTarget) => Promise<void> | void;
  importAction?: ReactNode;
};

type MaterialImportActionProps = {
  isImporting: boolean;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
};

function materialMeta(material: MaterialItem): string {
  const details = [material.pack_title];
  if (material.book) details.push(material.book);
  if (material.lesson) details.push(`Lesson ${material.lesson}`);
  return details.join(" · ");
}

type MaterialGroup = {
  id: string;
  packId: string;
  book: string;
  title: string;
  subtitle: string;
  source: string;
  materials: MaterialItem[];
};

function materialGroupId(material: MaterialItem): string {
  return `${material.pack_id}::${material.book || "unfiled"}`;
}

function lessonLabel(material: MaterialItem): string {
  return material.lesson || "New";
}

function lessonCountLabel(count: number): string {
  return `${count} lesson${count === 1 ? "" : "s"}`;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchesQuery(material: MaterialItem, query: string): boolean {
  if (!query) return true;
  return [
    material.title,
    material.text,
    material.pack_title,
    material.book,
    material.lesson,
    material.tags.join(" ")
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

export function MaterialLibrary({
  materials,
  onSelect,
  onDeleteGroup,
  importAction
}: MaterialLibraryProps) {
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const [deleteCandidate, setDeleteCandidate] = useState<MaterialGroup | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const deleteDialogRef = useRef<HTMLElement | null>(null);

  const groups = useMemo<MaterialGroup[]>(() => {
    const groupsById = new Map<string, MaterialGroup>();
    for (const material of materials) {
      const id = materialGroupId(material);
      const existing = groupsById.get(id);
      if (existing) {
        existing.materials.push(material);
        continue;
      }
      groupsById.set(id, {
        id,
        packId: material.pack_id,
        book: material.book || "",
        title: material.book || material.pack_title,
        subtitle: material.book ? material.pack_title : material.source,
        source: material.source,
        materials: [material]
      });
    }
    return [...groupsById.values()].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [materials]);

  const normalizedQuery = normalized(query);
  const visibleMaterials = useMemo(
    () =>
      materials.filter((material) => {
        const groupMatches = selectedGroupId === "all" || materialGroupId(material) === selectedGroupId;
        return groupMatches && matchesQuery(material, normalizedQuery);
      }),
    [materials, normalizedQuery, selectedGroupId]
  );
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const selectedGroupCanDelete = Boolean(
    selectedGroup && onDeleteGroup && selectedGroup.source !== "built-in"
  );
  const activeScopeLabel = normalizedQuery
    ? `Search: ${query.trim()}`
    : selectedGroup
      ? selectedGroup.title
      : "";

  useEffect(() => {
    if (selectedGroupId !== "all" && !selectedGroup) {
      setSelectedGroupId("all");
    }
  }, [selectedGroup, selectedGroupId]);

  useEffect(() => {
    if (!isLibraryOpen) return;
    window.requestAnimationFrame(() => dialogRef.current?.focus());
  }, [isLibraryOpen]);

  useEffect(() => {
    if (!deleteCandidate) return;
    window.requestAnimationFrame(() => deleteDialogRef.current?.focus());
  }, [deleteCandidate]);

  function closeLibrary() {
    setDeleteCandidate(null);
    setIsLibraryOpen(false);
  }

  function startMaterial(material: MaterialItem) {
    onSelect(material);
    closeLibrary();
  }

  function handleOverlayMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closeLibrary();
    }
  }

  function handleDialogBlur(event: FocusEvent<HTMLElement>) {
    const nextFocus = event.relatedTarget;
    if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) {
      return;
    }
    closeLibrary();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (deleteCandidate && !deletingGroupId) {
        event.preventDefault();
        setDeleteCandidate(null);
        return;
      }
      closeLibrary();
    }
  }

  function showDeleteConfirmation() {
    if (!selectedGroupCanDelete || !selectedGroup) return;
    setDeleteCandidate(selectedGroup);
  }

  function closeDeleteConfirmation() {
    if (deletingGroupId) return;
    setDeleteCandidate(null);
  }

  function handleDeleteConfirmationMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      closeDeleteConfirmation();
    }
  }

  async function deleteSelectedGroup() {
    const group = deleteCandidate;
    if (!group || !onDeleteGroup) return;
    const count = group.materials.length;

    setDeletingGroupId(group.id);
    try {
      await onDeleteGroup({
        id: group.id,
        packId: group.packId,
        book: group.book,
        title: group.title,
        count
      });
      setDeleteCandidate(null);
    } finally {
      setDeletingGroupId(null);
    }
  }

  const previewMaterials = visibleMaterials;
  const isDeletingCandidate = Boolean(
    deleteCandidate && deletingGroupId === deleteCandidate.id
  );
  const libraryDialog = isLibraryOpen ? (
    <div className="material-library-overlay" onMouseDown={handleOverlayMouseDown}>
      <section
        ref={dialogRef}
        className="material-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="material-library-title"
        tabIndex={-1}
        onBlur={handleDialogBlur}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="material-library-header">
          <div>
            <h2 id="material-library-title">Materials</h2>
            <p>Showing {visibleMaterials.length} of {materials.length} lessons</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={closeLibrary}
            title="Close library"
          >
            <X size={18} />
          </button>
        </header>

        <label className="material-library-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search materials"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, lesson, tag"
          />
        </label>

        <div className="material-library-layout">
          <nav className="material-group-list" aria-label="Material groups">
            <button
              type="button"
              className={`material-group ${selectedGroupId === "all" ? "selected" : ""}`}
              aria-label={`All ${materials.length}`}
              aria-current={selectedGroupId === "all" ? "true" : undefined}
              onClick={() => setSelectedGroupId("all")}
            >
              <strong>All</strong>
              <span>{materials.length}</span>
            </button>
            {groups.map((group) => (
              <button
                type="button"
                className={`material-group ${selectedGroupId === group.id ? "selected" : ""}`}
                aria-label={`${group.title} ${group.materials.length}`}
                aria-current={selectedGroupId === group.id ? "true" : undefined}
                key={group.id}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <strong>{group.title}</strong>
                <small>{group.subtitle}</small>
                <span>{group.materials.length}</span>
              </button>
            ))}
          </nav>

          <div className="material-library-lessons">
            {selectedGroup ? (
              <div className="material-library-group-toolbar">
                <span>
                  <strong>{selectedGroup.title}</strong>
                  <small>{selectedGroup.materials.length} lessons</small>
                </span>
                {selectedGroupCanDelete ? (
                  <button
                    type="button"
                    className="material-delete-group"
                    onClick={showDeleteConfirmation}
                    disabled={deletingGroupId === selectedGroup.id}
                    aria-haspopup="dialog"
                    aria-expanded={deleteCandidate?.id === selectedGroup.id ? "true" : "false"}
                  >
                    {deletingGroupId === selectedGroup.id ? (
                      <Loader2 className="spin" size={14} />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Delete group
                  </button>
                ) : null}
              </div>
            ) : null}
            {visibleMaterials.length === 0 ? (
              <p className="muted">No matching lessons.</p>
            ) : (
              visibleMaterials.map((material) => (
                <button
                  type="button"
                  className="material-library-lesson"
                  key={material.id}
                  onClick={() => startMaterial(material)}
                >
                  <span className="material-lesson-number">{lessonLabel(material)}</span>
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
                  <span className="material-start-label">Start</span>
                </button>
              ))
            )}
          </div>
        </div>
        {deleteCandidate ? (
          <div
            className="material-delete-confirm-backdrop"
            onMouseDown={handleDeleteConfirmationMouseDown}
          >
            <section
              ref={deleteDialogRef}
              className="material-delete-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="material-delete-confirm-title"
              aria-describedby="material-delete-confirm-description"
              tabIndex={-1}
            >
              <div className="material-delete-confirm-header">
                <span className="material-delete-confirm-icon" aria-hidden="true">
                  <AlertTriangle size={18} />
                </span>
                <div>
                  <h3 id="material-delete-confirm-title">Delete material group?</h3>
                  <p id="material-delete-confirm-description">
                    {`Delete ${lessonCountLabel(deleteCandidate.materials.length)} from "${deleteCandidate.title}"? This cannot be undone.`}
                  </p>
                </div>
              </div>
              <div className="material-delete-confirm-actions">
                <button
                  type="button"
                  className="material-delete-confirm-cancel"
                  onClick={closeDeleteConfirmation}
                  disabled={isDeletingCandidate}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="material-delete-confirm-danger"
                  onClick={() => void deleteSelectedGroup()}
                  disabled={isDeletingCandidate}
                >
                  {isDeletingCandidate ? (
                    <Loader2 className="spin" size={15} />
                  ) : (
                    <Trash2 size={15} />
                  )}
                  {isDeletingCandidate
                    ? "Deleting..."
                    : `Delete ${lessonCountLabel(deleteCandidate.materials.length)}`}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  ) : null;

  return (
    <>
      {!isLibraryOpen ? (
        <>
          <div className="material-library-summary">
            <button
              type="button"
              className="secondary-button compact material-library-open"
              onClick={() => setIsLibraryOpen(true)}
            >
              <BookOpen size={15} />
              Open Library
            </button>
            <span className="material-library-summary-actions">
              {importAction}
            </span>
            {activeScopeLabel ? (
              <span className="material-library-scope">{activeScopeLabel}</span>
            ) : null}
          </div>
          <div className="material-list compact" aria-label="Current material queue">
            {materials.length === 0 ? (
              <p className="muted">No materials yet.</p>
            ) : previewMaterials.length === 0 ? (
              <p className="muted">No matching materials.</p>
            ) : (
              previewMaterials.map((material) => (
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
        </>
      ) : null}

      {libraryDialog ? createPortal(libraryDialog, document.body) : null}
    </>
  );
}

export function MaterialImportAction({
  isImporting,
  onImport
}: MaterialImportActionProps) {
  return (
    <div className="material-import-actions">
      <span className="material-import-help">
        <button
          type="button"
          className="icon-button small material-import-info"
          aria-label="Material import format"
          aria-describedby="material-import-tooltip"
        >
          <Info size={14} />
        </button>
        <span className="material-import-tooltip" id="material-import-tooltip" role="tooltip">
          Import a .json file using schema_version: 1, pack &#123; id, title &#125;,
          lessons [&#123; id, title, text &#125;]. Optional fields: book, lesson, tags.
        </span>
      </span>
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
  );
}
