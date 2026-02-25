import { Node, mergeAttributes} from "@tiptap/core";
import { DOMParser } from "@tiptap/pm/model";
import { Plugin, PluginKey, Transaction } from "@tiptap/pm/state";
import { type Node as PMNode } from "@tiptap/pm/model";


declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headerFooter: {
      setHeaderFooterContent: (params: {contentLeft: string, contentRight: string, tr: Transaction, pageNumber?: number, position: "header"|"footer"}) => ReturnType;
    };
  }
}

export const ContentNode = Node.create({
  name: "contentNode",
  group: "contentNode",
  content: "block+",

  addAttributes() {
    return {
      class: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },
});

export const HeaderFooterNode = Node.create({
  name: "headerFooterNode",
  group: "headerFooterNode",
  content: "contentNode contentNode",
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      pageNumber: { default: -1 },
      position: {default: "header"},
    };
  },

  parseHTML() {
    return [{tag: 'div[data-header-footer]'}];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", HTMLAttributes, 0];
  },
});

export const HeaderFooterOptions = Node.create({
  name: "headerFooterOptions",
  group: "block",
  content: "headerFooterNode*",
  selectable: false,
  draggable: false,

  parseHTML() {
    return [{tag: 'div[data-header-footer-options]'}];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        style: "display:none;",
      }),
      0
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("headerFooterOptionsProtect"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some(tr => tr.docChanged)) return null;

          const oldFirstNode = oldState.doc.firstChild;
          const firstNode = newState.doc.firstChild;

          if (!firstNode && !oldFirstNode) return null;

          const optionsNodeWasPresent = oldFirstNode?.type.name === HeaderFooterOptions.name;

          const tr = newState.tr;

          const optionsNodes: {node:PMNode, pos: number}[] = [];
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "headerFooterOptions") {
              optionsNodes.push({node, pos});
            }
          });

          let mainOptionsNode = optionsNodes.length > 0 ?
            optionsNodes.reduce((max, obj) => obj.node.childCount > max.node.childCount ? obj : max)
            : null
          
          if (!mainOptionsNode && optionsNodeWasPresent) {
            tr.insert(0, oldFirstNode)
          }
          
          // Delete all OptionNodes to only keep the main node at the begining
          for (const optionsNode of optionsNodes) {
            const pos = tr.mapping.map(optionsNode.pos);
            tr.delete(pos, pos + optionsNode.node.nodeSize)
          }
          if (mainOptionsNode?.node && mainOptionsNode.pos !== null) {
            tr.insert(0, mainOptionsNode.node)
            return tr;
          }
          
          return tr.docChanged? tr : null;
        },
      })
    ];
  },
  addCommands() {
    return {
      setHeaderFooterContent: params =>
        ({ state, dispatch }) => {
          const { contentLeft, contentRight, pageNumber, position, tr } = params;
          const normalizedPageNumber = typeof pageNumber === "number" ? pageNumber : -1;
          if (!dispatch) return false;

          let optionsNode = tr.doc.nodeAt(0);

          if (!optionsNode) return false

          if (optionsNode.type.name !== HeaderFooterOptions.name) {
            const newOptionsNode = state.schema.nodes.headerFooterOptions.create();
            tr.insert(0, newOptionsNode);
            optionsNode = newOptionsNode;
          }
          
          // Find and remove the existing matching headerFooterNode inside it
          const innerOffset = 1; // +1 to step inside the parent
          const deleteRanges: Array<{ from: number; to: number }> = [];

          optionsNode.descendants((node, pos) => {
            if (
              node.type.name === "headerFooterNode" &&
              node.attrs.position === position &&
              node.attrs.pageNumber === normalizedPageNumber
            ) {
              deleteRanges.push({
                from: innerOffset + pos,
                to: innerOffset + pos + node.nodeSize,
              });
            }
          });

          deleteRanges
            .sort((a, b) => b.from - a.from)
            .forEach(({ from, to }) => tr.delete(tr.mapping.map(from), tr.mapping.map(to)));
  
          // Build the new headerFooterNode
          const parseToContentNode = (html: string, cls: string) => {
            const span = document.createElement('span');
            span.classList.add(cls);
            span.innerHTML = html.trim().length > 0 ? html : "<p></p>";
            const parsed = DOMParser.fromSchema(state.schema).parse(span, {
              topNode: state.schema.nodes.contentNode.create(),
            });
            return state.schema.nodes.contentNode.create({ class: cls }, parsed.content);
          };

          const newHeaderFooter = state.schema.nodes.headerFooterNode.createChecked(
            { pageNumber: normalizedPageNumber, position },
            [
              parseToContentNode(contentLeft, "contentLeft"),
              parseToContentNode(contentRight, "contentRight"),
            ]
          );
          tr.insert(1, newHeaderFooter);

          dispatch(tr);
          return true
        },
    };
  }
})