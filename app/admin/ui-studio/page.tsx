import {notFound} from 'next/navigation';
import {getAdminAccessMode} from '@/lib/adminAuth';
import {readUiDesignState} from '@/lib/uiDesignStore';
import {UiStudio} from '@/components/UiStudio';
export const dynamic='force-dynamic';
export default async function Page(){if(await getAdminAccessMode()!=='developer')notFound();return <UiStudio initial={await readUiDesignState()}/>;}
