import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

const get = (path) => () => api.get(path)

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: get('/api/config'), staleTime: Infinity })
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: get('/api/me'), retry: false })

export function useLogin() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (creds) => api.post('/api/auth/login', creds),
    onSuccess: (me) => {
      client.clear()
      client.setQueryData(['me'], me)
    },
  })
}

export function useLogout() {
  const client = useQueryClient()
  return useMutation({ mutationFn: () => api.post('/api/auth/logout'), onSuccess: () => client.clear() })
}
export const useWallet = () => useQuery({ queryKey: ['wallet'], queryFn: get('/api/wallet') })
export const useWeekStats = () => useQuery({ queryKey: ['stats', 'week'], queryFn: get('/api/stats/week') })
export const useNetwork = () => useQuery({ queryKey: ['network'], queryFn: get('/api/network'), staleTime: Infinity })

export const useRoutes = () => useQuery({ queryKey: ['routes'], queryFn: get('/api/routes') })
export const useStops = (routeId) =>
  useQuery({ queryKey: ['stops', routeId], queryFn: get(`/api/routes/${routeId}/stops`), enabled: !!routeId })
export const useTrips = () => useQuery({ queryKey: ['trips'], queryFn: get('/api/trips') })
export const useActiveTrip = () => useQuery({ queryKey: ['trips', 'active'], queryFn: get('/api/trips/active') })
export const useTeamActivity = () => useQuery({ queryKey: ['activity', 'team'], queryFn: get('/api/activity?scope=team') })
export const useTeamTrees = () => useQuery({ queryKey: ['team', 'trees'], queryFn: get('/api/team/trees') })
// Polls at the tracker's upload cadence so live teammates move as their points arrive.
export const useTeamMap = () => useQuery({
  queryKey: ['team', 'map'],
  queryFn: get('/api/team/map'),
  refetchInterval: (q) => (q.state.data?.refresh_s ?? 0) * 1000,
})
export const useLogTree = () => {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (form) => api.post('/api/trees', form),
    onSettled: () => client.invalidateQueries({ queryKey: ['activity'] }),
  })
}

export const useLeaderboard = (q = '') => useQuery({
  queryKey: ['leaderboard', q],
  queryFn: get(`/api/leaderboard?q=${encodeURIComponent(q)}`),
  placeholderData: keepPreviousData,
})

export const useMarket = () => useQuery({ queryKey: ['market', 'summary'], queryFn: get('/api/market') })
export const useListings = () => useQuery({ queryKey: ['market', 'listings'], queryFn: get('/api/market/listings') })
export const useMyListings = () => useQuery({ queryKey: ['market', 'mine'], queryFn: get('/api/market/listings/mine') })
export const useMyTrades = () => useQuery({ queryKey: ['market', 'trades'], queryFn: get('/api/market/trades') })

function useWalletMutation(mutationFn) {
  const client = useQueryClient()
  return useMutation({
    mutationFn,
    onSettled: () => Promise.all([
      client.invalidateQueries({ queryKey: ['market'] }),
      client.invalidateQueries({ queryKey: ['wallet'] }),
    ]),
  })
}

export const useBuy = () => useWalletMutation((order) => api.post('/api/market/buy', order))
export const useCreateListing = () => useWalletMutation((listing) => api.post('/api/market/listings', listing))
export const useCancelListing = () => useWalletMutation((id) => api.delete(`/api/market/listings/${id}`))
export const useConvert = () => useWalletMutation((req) => api.post('/api/wallet/convert', req))

/** Refetches everything a finished commute changes: trips, wallet, office stats, standings and team views. */
export function useRefreshAfterTrip() {
  const client = useQueryClient()
  return () => Promise.all(['trips', 'wallet', 'stats', 'leaderboard', 'activity', 'team'].map(
    (key) => client.invalidateQueries({ queryKey: [key] }),
  ))
}

function useTripMutation(mutationFn) {
  const refresh = useRefreshAfterTrip()
  return useMutation({ mutationFn, onSettled: refresh })
}

export const useStartTrip = () => useTripMutation((body) => api.post('/api/trips/start', body))
export const useFinishTrip = () => useTripMutation(({ id, ...body }) => api.post(`/api/trips/${id}/finish`, body))
export const useCancelTrip = () => useTripMutation((id) => api.post(`/api/trips/${id}/cancel`))
// No refetch here: DemoReplay calls useRefreshAfterTrip once its animation ends, so the numbers change on arrival.
export const useDemoReplay = () => useMutation({ mutationFn: (routeId) => api.post('/api/demo/replay', { route_id: routeId }) })
