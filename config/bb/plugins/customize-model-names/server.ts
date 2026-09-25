import {
  cliCommand,
  defineCli,
  defineRpcContract,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  parseRenames,
  parseVisibleModels,
  type Config,
  type Rename,
  type VisibleModels,
} from "./rename";

const renameSchema = z.object({
  from: z.string().trim().min(1).max(200),
  to: z.string().max(200),
});

const visibleModelsSchema = z.record(
  z.string().trim().min(1),
  z.array(z.string().trim().min(1).max(200)).max(100),
);

// ponytail: pre-filled with the owner's picks; edit in Settings or `bb model-names visible-*`.
const DEFAULT_VISIBLE_MODELS: VisibleModels = {
  "claude-code": ["Opus 5.5", "Fable 5.1"],
  codex: ["GPT-6*"],
};

// Codex labels as bb shows them: "GPT-6-Sol" in threads, "6-Sol" in the picker.
// Bare "5.5" is left out: an exact match on it would hit unrelated text.
const DEFAULT_RENAMES: Rename[] = ["6-Sol", "6-Astra", "6-Luna", "5.6-Sol", "5.6-Terra", "5.6-Luna"].flatMap(
  (label) => {
    const [version, variant] = label.split("-");
    const to = `GPT-${version} ${variant}`;
    return [
      { from: `GPT-${label}`, to },
      { from: label, to },
    ];
  },
);

const configSchema = z.object({
  renames: z.array(renameSchema),
  visibleModels: visibleModelsSchema,
});

export const rpcContract = defineRpcContract({
  getConfig: {
    input: z.null(),
    output: configSchema,
  },
  setConfig: {
    input: z
      .object({
        renames: z.array(renameSchema).max(200).optional(),
        visibleModels: visibleModelsSchema.optional(),
      })
      .strict(),
    output: configSchema,
  },
});

export const CONFIG_CHANNEL = "config";

export default function customizeModelNames(bb: BbPluginApi) {
  const settings = bb.settings.define({
    renames: {
      type: "string",
      label: "Renames (JSON)",
      experimental_multiline: true,
      experimental_schema: z.string().refine((value) => {
        try {
          return z.array(renameSchema).safeParse(JSON.parse(value)).success;
        } catch {
          return false;
        }
      }, 'Renames must be a JSON array like [{"from": "6-Astra", "to": "Astra"}]'),
      default: JSON.stringify(DEFAULT_RENAMES, null, 2),
    },
    visibleModels: {
      type: "string",
      label: "Show only these models in the picker (JSON)",
      description:
        'Per provider id, labels or model ids to keep in the model picker; a trailing * matches any suffix. A missing or empty provider shows all. Example: {"codex": ["GPT-6*"]}',
      experimental_multiline: true,
      experimental_schema: z.string().refine((value) => {
        try {
          return visibleModelsSchema.safeParse(JSON.parse(value)).success;
        } catch {
          return false;
        }
      }, 'Visible models must be a JSON object like {"codex": ["GPT-6*"]}'),
      default: JSON.stringify(DEFAULT_VISIBLE_MODELS, null, 2),
    },
  });

  const read = async (): Promise<Config> => {
    const values = await settings.get();
    return {
      renames: parseRenames(values.renames),
      visibleModels: parseVisibleModels(values.visibleModels),
    };
  };

  const write = async (next: {
    renames?: Rename[];
    visibleModels?: VisibleModels;
  }) => {
    await settings.experimental_set({
      ...(next.renames === undefined
        ? {}
        : { renames: JSON.stringify(next.renames, null, 2) }),
      ...(next.visibleModels === undefined
        ? {}
        : { visibleModels: JSON.stringify(next.visibleModels, null, 2) }),
    });
    return read();
  };

  // Every window re-reads on this signal, whatever made the change.
  settings.onChange(() => {
    bb.realtime.publish(CONFIG_CHANNEL, {});
  });

  bb.rpc.register(rpcContract, {
    getConfig: () => read(),
    setConfig: (input) => write(input),
  });

  const formatVisible = (visibleModels: VisibleModels) => {
    const entries = Object.entries(visibleModels);
    return entries.length === 0
      ? "Show only: all models (no list)"
      : ["Show only:", ...entries.map(([p, patterns]) => `  ${p}: ${patterns.join(", ")}`)].join(
          "\n",
        );
  };

  const format = ({ renames, visibleModels }: Config) =>
    [
      renames.length === 0
        ? "Renames: none"
        : ["Renames:", ...renames.map((r) => `  ${r.from}  →  ${r.to}`)].join("\n"),
      formatVisible(visibleModels),
    ].join("\n");

  bb.cli.register(
    defineCli({
      name: "model-names",
      summary: "Rename or hide models in bb's model labels and picker",
      commands: {
        list: cliCommand({
          summary: "Show renames and show-only lists",
          options: { json: { type: "boolean", description: "Emit JSON" } },
          async run(input) {
            const config = await read();
            return {
              exitCode: 0,
              stdout: input.options.json ? JSON.stringify(config) : format(config),
            };
          },
        }),
        add: cliCommand({
          summary: "Show <from> as <to> (exact label match); replaces an existing entry",
          positionals: [
            { name: "from", description: 'Label as bb shows it, e.g. "6-Astra"', required: true },
            { name: "to", description: 'Label to show instead, e.g. "Astra"', required: true },
          ],
          async run(input) {
            const entry = renameSchema.safeParse({
              from: input.positionals.from,
              to: input.positionals.to,
            });
            if (!entry.success) {
              throw new PluginCliError("from must be 1–200 characters; to at most 200", {
                code: "invalid_rename",
              });
            }
            const { renames } = await read();
            const next = [...renames.filter((r) => r.from !== entry.data.from), entry.data];
            return { exitCode: 0, stdout: format(await write({ renames: next })) };
          },
        }),
        remove: cliCommand({
          summary: "Remove the custom rename for <from>",
          positionals: [
            { name: "from", description: "The entry's from label", required: true },
          ],
          async run(input) {
            const { renames } = await read();
            const next = renames.filter((r) => r.from !== input.positionals.from);
            if (next.length === renames.length) {
              throw new PluginCliError(`no rename for "${input.positionals.from}"`, {
                code: "rename_not_found",
                hint: "Run `bb model-names list` to see entries.",
              });
            }
            return { exitCode: 0, stdout: format(await write({ renames: next })) };
          },
        }),
        visible: cliCommand({
          summary: "Show the per-provider show-only lists for the model picker",
          options: { json: { type: "boolean", description: "Emit JSON" } },
          async run(input) {
            const { visibleModels } = await read();
            return {
              exitCode: 0,
              stdout: input.options.json ? JSON.stringify(visibleModels) : formatVisible(visibleModels),
            };
          },
        }),
        "visible-add": cliCommand({
          summary: "Keep models matching <pattern> (label or id; trailing * wildcard) for <provider>",
          positionals: [
            { name: "provider", description: 'Provider id, e.g. "codex" or "claude-code"', required: true },
            { name: "pattern", description: 'e.g. "Opus 5.5", "claude-opus-5-5", "GPT-6*"', required: true },
          ],
          async run(input) {
            const provider = input.positionals.provider.trim();
            const pattern = input.positionals.pattern.trim();
            if (provider === "" || pattern === "" || pattern.length > 200) {
              throw new PluginCliError("provider and pattern must be non-empty; pattern at most 200", {
                code: "invalid_pattern",
              });
            }
            const { visibleModels } = await read();
            const current = visibleModels[provider] ?? [];
            const next = { ...visibleModels, [provider]: [...current.filter((p) => p !== pattern), pattern] };
            return { exitCode: 0, stdout: formatVisible((await write({ visibleModels: next })).visibleModels) };
          },
        }),
        "visible-remove": cliCommand({
          summary: "Remove <pattern> from <provider>'s list, or the whole list (show all) without <pattern>",
          positionals: [
            { name: "provider", description: "Provider id", required: true },
            { name: "pattern", description: "Pattern to remove; omit to clear the provider", required: false },
          ],
          async run(input) {
            const { provider, pattern } = input.positionals;
            const { visibleModels } = await read();
            const current = visibleModels[provider];
            const kept = pattern === undefined ? [] : (current ?? []).filter((p) => p !== pattern);
            if (current === undefined || kept.length === current.length) {
              throw new PluginCliError(
                pattern === undefined ? `no list for "${provider}"` : `"${pattern}" is not in "${provider}"'s list`,
                { code: "pattern_not_found", hint: "Run `bb model-names visible` to see lists." },
              );
            }
            const next = { ...visibleModels };
            if (kept.length === 0) delete next[provider];
            else next[provider] = kept;
            return { exitCode: 0, stdout: formatVisible((await write({ visibleModels: next })).visibleModels) };
          },
        }),
      },
    }),
  );

  bb.log.info("Customize Model Visibility loaded");
}
