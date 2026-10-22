import { TooltipProvider } from '@/components/ui/tooltip'

export default function App() {
  return (
    <TooltipProvider>
      <main className="flex h-screen items-center justify-center">
        <h1 className="text-xl font-semibold">Nikon Recipe Previewer</h1>
      </main>
    </TooltipProvider>
  )
}
