// TanStack Query hooks — the frontend's server-state layer.
// Queries cache + refetch; mutations invalidate; provisioning is polled declaratively.

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { request, tokenStore } from "./client";
import type {
  GithubStatus,
  LoginResponse,
  ModelOption,
  RepoRef,
  RepoScan,
  ScanArg,
  Submission,
  SubmissionDetail,
  SubmissionInput,
  User,
  ValidationResponse,
} from "../types";

// ----------------------------------------------------------------- query options

export const modelsQuery = queryOptions({
  queryKey: ["models"],
  queryFn: () => request<ModelOption[]>("/models"),
  staleTime: Infinity,
});

export const submissionsQuery = queryOptions({
  queryKey: ["submissions"],
  queryFn: () => request<Submission[]>("/submissions"),
  // Keep the queue fresh while any app is mid-provision, so its badge + the
  // action bar flip to "live" without a manual refresh.
  refetchInterval: (query) =>
    query.state.data?.some((s) => s.status === "provisioning") ? 800 : false,
});

export function submissionQuery(id: string | undefined) {
  return queryOptions({
    queryKey: ["submission", id],
    queryFn: () => request<SubmissionDetail>(`/submissions/${id}`),
    enabled: !!id,
    // Poll while the simulated provisioner is running; stop once live/failed.
    refetchInterval: (query) =>
      query.state.data?.submission.status === "provisioning" ? 800 : false,
  });
}

// ----------------------------------------------------------------- query hooks

export const useModels = () => useQuery(modelsQuery);
export const useSubmissions = () => useQuery(submissionsQuery);
export const useSubmission = (id: string | undefined) => useQuery(submissionQuery(id));

export const useDevUsers = () =>
  useQuery({ queryKey: ["dev-users"], queryFn: () => request<User[]>("/auth/dev-users") });

export const useMe = (enabled: boolean) =>
  useQuery({ queryKey: ["me"], queryFn: () => request<User>("/auth/me"), enabled, retry: false });

// ----------------------------------------------------------------- mutations

export const useScan = () =>
  useMutation({
    // Accepts a public { repoUrl } or a connected { repoFullName }.
    mutationFn: (arg: ScanArg) =>
      request<RepoScan>("/scan", { method: "POST", body: JSON.stringify(arg) }),
  });

// ----- GitHub App connect -----
export const githubStatusQuery = queryOptions({
  queryKey: ["github", "status"],
  queryFn: () => request<GithubStatus>("/github/status"),
});

export const useGithubStatus = () => useQuery(githubStatusQuery);

export const useGithubRepos = (enabled: boolean) =>
  useQuery({
    queryKey: ["github", "repos"],
    queryFn: () => request<RepoRef[]>("/github/repos"),
    enabled,
  });

export const useGithubConnect = () =>
  useMutation({
    mutationFn: () => request<{ authorizeUrl: string }>("/github/connect"),
  });

export function useDisconnectGithub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<void>("/github/disconnect", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["github"] }),
  });
}

export const useValidate = () =>
  useMutation({
    mutationFn: (input: SubmissionInput) =>
      request<ValidationResponse>("/validate", { method: "POST", body: JSON.stringify(input) }),
  });

export function useCreateSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmissionInput) =>
      request<SubmissionDetail>("/submissions", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["submissions"] }),
  });
}

export function useApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<Submission>(`/submissions/${id}/approve`, { method: "POST" }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["submissions"] });
      qc.invalidateQueries({ queryKey: ["submission", id] });
    },
  });
}

export function usePatchSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      request<Submission>(`/submissions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["submissions"] });
      qc.invalidateQueries({ queryKey: ["submission", id] });
    },
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: (email: string) =>
      request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email }) }),
    onSuccess: (data) => tokenStore.set(data.token),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<void>("/auth/logout", { method: "POST" }),
    onSettled: () => {
      tokenStore.set("");
      qc.clear();
    },
  });
}
