declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it'

  interface TaskListsOptions {
    /** Render the checkboxes as enabled (interactive) inputs. Defaults to false. */
    enabled?: boolean
    /** Wrap the list item text in a <label>. */
    label?: boolean
    /** Place the <label> after the checkbox. */
    labelAfter?: boolean
  }

  const taskLists: (md: MarkdownIt, options?: TaskListsOptions) => void
  export default taskLists
}
