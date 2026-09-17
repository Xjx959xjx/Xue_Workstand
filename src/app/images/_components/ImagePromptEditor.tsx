"use client";
/* eslint-disable @next/next/no-img-element -- Local reference thumbnails. */
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import type { SuggestionProps } from "@tiptap/suggestion";
import { imageFileUrl, type ImageFile } from "@/lib/image-generation-types";
import { imageMentionPattern, imageMentionToken } from "@/lib/image-mentions";

type Choice = { id: string; label: string };
function contentFromPrompt(prompt: string): JSONContent {
  return { type: "doc", content: prompt.split("\n").map((line) => {
    const content: JSONContent[] = []; let cursor = 0;
    for (const match of line.matchAll(imageMentionPattern())) {
      if (match.index! > cursor) content.push({ type: "text", text: line.slice(cursor, match.index) });
      content.push({ type: "mention", attrs: { id: match[2], label: match[1] } });
      cursor = match.index! + match[0].length;
    }
    if (cursor < line.length) content.push({ type: "text", text: line.slice(cursor) });
    return { type: "paragraph", content };
  }) };
}
export default function ImagePromptEditor({ value, references, disabled, onChange, onLocate, onReference, onPasteFiles, onError }: {
  onPasteFiles: (files: File[]) => Promise<ImageFile[] | undefined>; onError: (error: unknown) => void;
  value: string; references: ImageFile[]; disabled: boolean; onChange: (value: string) => void; onLocate: (id: string) => void; onReference: (image: ImageFile) => boolean;
}) {
  const latest = useRef({ references, onChange, onLocate, onReference, onPasteFiles, onError }); latest.current = { references, onChange, onLocate, onReference, onPasteFiles, onError };
  const [suggestion, setSuggestion] = useState<SuggestionProps<Choice> | null>(null);
  const [highlight, setHighlight] = useState(0);
  const menuState = useRef<{ props: SuggestionProps<Choice> | null; index: number }>({ props: null, index: 0 });
  const lastEmitted = useRef(value);
  const choices = useRef<HTMLDivElement>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, bulletList: false, orderedList: false, blockquote: false, codeBlock: false, horizontalRule: false, link: false, underline: false }), Mention.configure({
      renderText: ({ node }) => imageMentionToken(node.attrs.id, node.attrs.label || "参考图"),
      renderHTML: ({ node }) => ["span", { class: "image-prompt-mention", "data-image-id": node.attrs.id }, ["img", { src: imageFileUrl(node.attrs.id), alt: "", draggable: "false" }], `@${node.attrs.label || "参考图"}`],
      suggestion: {
        allowedPrefixes: null,
        command: ({ editor, range, props }) => {
          const image = latest.current.references.find((item) => item.id === props.id);
          if (!image || !latest.current.onReference(image)) return;
          editor.chain().focus().insertContentAt(range, [{ type: "mention", attrs: props }, { type: "text", text: " " }]).run();
        },
        items: ({ query }) => latest.current.references.filter((image) => image.name.toLowerCase().includes(query.toLowerCase())).map((image) => ({ id: image.id, label: image.name })),
        render: () => {
          const update = (props: SuggestionProps<Choice>) => { menuState.current = { props, index: 0 }; setHighlight(0); setSuggestion(props); };
          return { onStart: update, onUpdate: update, onExit: () => { menuState.current.props = null; setSuggestion(null); }, onKeyDown: ({ event }) => {
            const state = menuState.current;
            if (event.key === "Escape") { menuState.current.props = null; setSuggestion(null); return true; }
            if (!state.props?.items.length) return false;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { state.index = (state.index + (event.key === "ArrowDown" ? 1 : -1) + state.props.items.length) % state.props.items.length; setHighlight(state.index); return true; }
            if (event.key === "Enter") { state.props.command(state.props.items[state.index]); return true; }
            return false;
          } };
        }
      }
    })],
    content: contentFromPrompt(value),
    editorProps: {
      attributes: { id: "image-prompt", role: "textbox", "aria-label": "提示词，输入 @ 引用参考图", "aria-multiline": "true", "data-placeholder": "描述画面，输入 @ 选择参考图…" },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return false;
        event.preventDefault(); event.stopPropagation();
        const { from, to } = view.state.selection;
        void latest.current.onPasteFiles(files).then((images) => {
          if (!images?.length || view.isDestroyed) return;
          const nodes = images.flatMap((image) => [
            view.state.schema.nodes.mention.create({ id: image.id, label: image.name }),
            view.state.schema.text(" ")
          ]);
          const end = view.state.doc.content.size;
          const transaction = view.state.tr.replaceWith(Math.min(from, end), Math.min(to, end), nodes);
          view.dispatch(transaction.scrollIntoView());
          view.focus();
        }).catch((error) => latest.current.onError(error));
        return true;
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-image-id]") : null;
        if (!target?.dataset.imageId) return false;
        latest.current.onLocate(target.dataset.imageId); return true;
      }
    },
    onUpdate: ({ editor }) => { const text = editor.getText({ blockSeparator: "\n" }); lastEmitted.current = text; latest.current.onChange(text); }
  }, []);
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  useEffect(() => {
    if (editor && value !== lastEmitted.current) { editor.commands.setContent(contentFromPrompt(value), { emitUpdate: false }); lastEmitted.current = value; }
  }, [editor, value]);
  useEffect(() => {
    choices.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [highlight]);
  const preview = suggestion?.items[highlight];
  return <div className="image-prompt-editor">
    <div className="image-field-heading"><label htmlFor="image-prompt">创作指令</label><button className="btn small" type="button" disabled={disabled || !references.length} onClick={() => editor?.chain().focus().insertContent("@").run()}>@ 引用素材</button></div>
    <EditorContent editor={editor} />
    {suggestion ? <div className="image-mention-menu">
      <div ref={choices} className="image-mention-choices" role="listbox" aria-label="选择参考图">{suggestion.items.length ? suggestion.items.map((item, index) => <button className="btn ghost" role="option" aria-selected={index === highlight} key={item.id} type="button" onPointerEnter={() => { menuState.current.index = index; setHighlight(index); }} onFocus={() => { menuState.current.index = index; setHighlight(index); }} onMouseDown={(event) => event.preventDefault()} onClick={() => suggestion.command(item)}><img src={imageFileUrl(item.id)} alt="" /><span>{item.label}</span></button>) : <p role="status">{references.length ? "没有匹配的参考图" : "请先添加参考图"}</p>}</div>
      {preview ? <div className="image-mention-preview" aria-hidden="true"><img key={preview.id} src={imageFileUrl(preview.id)} alt="" /><span>{preview.label}</span><small>点击右侧图片即可引用</small></div> : null}
    </div> : null}
  </div>;
}
