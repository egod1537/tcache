import {
  Button,
  Callout,
  Checkbox,
  Classes,
  Collapse,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Intent,
  NumericInput,
  TextArea,
} from '@blueprintjs/core';
import { useMemo, useState } from 'react';

import {
  getOpenWebUIModels,
  type OpenWebUIModel,
} from '../../../apps/testbed/src/api/client';
import { JsonViewer } from '../../../apps/testbed/src/components/common/JsonViewer';
import {
  buildAiJobRequest,
  topPOptionKey,
  type AiProviderChoice as Provider,
} from '../ai-request-builder';

interface NewAiJobDialogProps {
  dark: boolean;
  isOpen: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (request: unknown) => Promise<void>;
}

export function NewAiJobDialog({
  dark,
  isOpen,
  creating,
  onClose,
  onCreate,
}: NewAiJobDialogProps) {
  const [provider, setProvider] = useState<Provider>('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(
    'You are a concise assistant.',
  );
  const [userPrompt, setUserPrompt] = useState('Summarize the cache status.');
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptVersion, setPromptVersion] = useState('v1');
  const [temperature, setTemperature] = useState('0.2');
  const [topP, setTopP] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [rawMessages, setRawMessages] = useState('');
  const [contextJson, setContextJson] = useState('');
  const [models, setModels] = useState<OpenWebUIModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [error, setError] = useState('');

  function selectProvider(value: Provider) {
    setProvider(value);
    setModel(value === 'mock' ? 'mock-ai-v1' : '');
    setModelsError('');
  }

  async function discoverModels() {
    setModelsLoading(true);
    setModelsError('');
    try {
      const discovered = await getOpenWebUIModels();
      setModels(discovered);
      setModelsLoaded(true);
      if (!model && discovered[0]) setModel(discovered[0].id);
    } catch (discoveryError) {
      setModels([]);
      setModelsLoaded(false);
      setModel('');
      setModelsError(
        discoveryError instanceof Error
          ? discoveryError.message
          : 'Failed to load OpenWebUI models',
      );
    } finally {
      setModelsLoading(false);
    }
  }

  const built = useMemo(
    () =>
      buildAiJobRequest({
        provider,
        model,
        systemPrompt,
        userPrompt,
        promptVersion,
        temperature,
        topP,
        rawMessages,
        contextJson,
        cacheEnabled,
      }),
    [
      provider,
      model,
      systemPrompt,
      userPrompt,
      promptVersion,
      temperature,
      topP,
      rawMessages,
      contextJson,
      cacheEnabled,
    ],
  );
  const topPKey = topPOptionKey(provider);

  async function submit() {
    if (!built.ok) {
      setError(built.error);
      return;
    }
    const request = built.request;

    setError('');
    try {
      await onCreate(request);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Failed to create job',
      );
    }
  }

  return (
    <Dialog
      canEscapeKeyClose={!creating}
      className="new-route-job-dialog"
      icon="predictive-analysis"
      isCloseButtonShown={!creating}
      isOpen={isOpen}
      onClose={onClose}
      title="New AI Job"
      {...(dark ? { portalClassName: Classes.DARK } : {})}
    >
      <DialogBody>
        <p className={Classes.TEXT_MUTED}>
          Create a Job through the existing cache and SSE pipeline. Leave the
          provider or model at Server Default to use server configuration.
        </p>

        <div className="ai-job-form-grid">
          <FormGroup label="Provider" labelFor="ai-provider">
            <HTMLSelect
              fill
              id="ai-provider"
              onChange={(event) =>
                selectProvider(event.target.value as Provider)
              }
              value={provider}
            >
              <option value="">Server Default</option>
              <option value="gemini">Gemini</option>
              <option value="openwebui">OpenWebUI</option>
              <option value="mock">Mock</option>
            </HTMLSelect>
          </FormGroup>

          <FormGroup
            helperText={
              provider === ''
                ? 'The server chooses both provider and model.'
                : provider === 'mock'
                  ? 'The built-in mock model is selected automatically.'
                  : 'Leave blank to use the provider default.'
            }
            label="Model"
            labelFor="ai-model"
          >
            {provider === 'openwebui' ? (
              <div className="ai-model-controls">
                <HTMLSelect
                  disabled={!models.length}
                  fill
                  id="ai-model"
                  onChange={(event) => setModel(event.target.value)}
                  value={model}
                >
                  <option value="">Server default</option>
                  {models.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                      {candidate.name === candidate.id
                        ? ''
                        : ` (${candidate.id})`}
                    </option>
                  ))}
                </HTMLSelect>
                <Button
                  icon="refresh"
                  loading={modelsLoading}
                  onClick={() => void discoverModels()}
                >
                  모델 목록 조회
                </Button>
              </div>
            ) : (
              <InputGroup
                disabled={provider === '' || provider === 'mock'}
                id="ai-model"
                onChange={(event) => setModel(event.target.value)}
                placeholder={
                  provider === 'gemini'
                    ? 'Server default (GEMINI_MODEL)'
                    : 'Server default'
                }
                value={model}
              />
            )}
          </FormGroup>
        </div>

        {modelsError && (
          <Callout compact intent={Intent.DANGER} role="alert">
            {modelsError}
          </Callout>
        )}
        {provider === 'openwebui' && modelsLoaded && !models.length && (
          <Callout compact icon="info-sign">
            OpenWebUI returned no available models.
          </Callout>
        )}

        <FormGroup label="System Prompt" labelFor="ai-system-prompt">
          <TextArea
            fill
            id="ai-system-prompt"
            onChange={(event) => setSystemPrompt(event.target.value)}
            rows={3}
            value={systemPrompt}
          />
        </FormGroup>

        <FormGroup label="User Prompt" labelFor="ai-user-prompt">
          <TextArea
            fill
            id="ai-user-prompt"
            onChange={(event) => setUserPrompt(event.target.value)}
            rows={5}
            value={userPrompt}
          />
        </FormGroup>

        <FormGroup
          helperText='Optional. Sent as an explicit first "user" message ("Context JSON:" + formatted JSON), before all other messages. Check Request preview.'
          label="Context JSON"
          labelFor="ai-context-json"
        >
          <TextArea
            className={Classes.MONOSPACE_TEXT}
            fill
            id="ai-context-json"
            onChange={(event) => setContextJson(event.target.value)}
            placeholder={'{"destination":"Tokyo","days":3}'}
            rows={4}
            spellCheck={false}
            value={contextJson}
          />
        </FormGroup>

        <Checkbox
          checked={cacheEnabled}
          label="Cache enabled"
          onChange={(event) => setCacheEnabled(event.currentTarget.checked)}
        />

        <Button
          alignText="left"
          fill
          icon={advancedOpen ? 'chevron-up' : 'chevron-down'}
          onClick={() => setAdvancedOpen((open) => !open)}
          variant="minimal"
        >
          Advanced
        </Button>
        <Collapse isOpen={advancedOpen}>
          <div className="ai-advanced-fields">
            <FormGroup label="Prompt version" labelFor="ai-prompt-version">
              <InputGroup
                id="ai-prompt-version"
                onChange={(event) => setPromptVersion(event.target.value)}
                value={promptVersion}
              />
            </FormGroup>
            <FormGroup label="Temperature" labelFor="ai-temperature">
              <NumericInput
                allowNumericCharactersOnly
                fill
                id="ai-temperature"
                majorStepSize={0.5}
                max={2}
                min={0}
                minorStepSize={0.1}
                onValueChange={(_value, valueAsString) =>
                  setTemperature(valueAsString)
                }
                stepSize={0.1}
                value={temperature}
              />
            </FormGroup>
            <FormGroup
              helperText={
                topPKey
                  ? `Optional, 0–1. Sent as "${topPKey}" for this provider.`
                  : 'Optional, 0–1. Select a provider first: the option name is provider-specific.'
              }
              label="Top-P"
              labelFor="ai-top-p"
            >
              <NumericInput
                allowNumericCharactersOnly
                fill
                id="ai-top-p"
                majorStepSize={0.1}
                max={1}
                min={0}
                minorStepSize={0.01}
                onValueChange={(_value, valueAsString) =>
                  setTopP(valueAsString)
                }
                placeholder="Provider default"
                stepSize={0.05}
                value={topP}
              />
            </FormGroup>
          </div>
          <FormGroup
            helperText="When set, this array replaces User Prompt."
            label="Raw messages JSON"
            labelFor="ai-raw-messages"
          >
            <TextArea
              className={Classes.MONOSPACE_TEXT}
              fill
              id="ai-raw-messages"
              onChange={(event) => setRawMessages(event.target.value)}
              placeholder={'[{"role":"user","content":"Hello"}]'}
              rows={6}
              spellCheck={false}
              value={rawMessages}
            />
          </FormGroup>
        </Collapse>

        <Button
          alignText="left"
          fill
          icon={previewOpen ? 'chevron-up' : 'chevron-down'}
          onClick={() => setPreviewOpen((open) => !open)}
          variant="minimal"
        >
          Request preview
        </Button>
        <Collapse isOpen={previewOpen}>
          {built.ok ? (
            <JsonViewer
              title="Request body (POST /api/ai/jobs)"
              value={built.request}
            />
          ) : (
            <Callout compact intent={Intent.WARNING} role="status">
              {built.error}
            </Callout>
          )}
        </Collapse>

        {error && (
          <Callout compact intent={Intent.DANGER} role="alert">
            {error}
          </Callout>
        )}
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button disabled={creating} onClick={onClose}>
              Cancel
            </Button>
            <Button
              icon="play"
              intent={Intent.PRIMARY}
              loading={creating}
              onClick={() => void submit()}
            >
              Create Job
            </Button>
          </>
        }
      />
    </Dialog>
  );
}
